import { computed, inject, Injectable, signal } from '@angular/core';
import { RecordModel } from 'pocketbase';
import { LocalStore } from '../data/local-store';
import { PhotoTask } from '../data/db';
import { ensurePersistentStorage } from '../data/persistent-storage';
import { COLLECTIONS, PULL_ORDER } from '../models/collections';
import { Cursor, isAuthError, PocketBaseGateway } from './pocketbase-gateway';
import {
  householdToRecord,
  meterToRecord,
  photoFilename,
  readingToRecord,
  recordToHousehold,
  recordToMeter,
  recordToReading,
  remotePhotoFile,
} from './sync-mapping';

export type SyncStatus = 'off' | 'needsAuth' | 'offline' | 'syncing' | 'photos' | 'idle' | 'error';

const SIGNED_OUT_KEY = 'meter-tracker.signedOut';
const SYNC_INTERVAL_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly store = inject(LocalStore);
  private readonly pb = inject(PocketBaseGateway);
  readonly serverUrl = this.pb.baseUrl;
  readonly userEmail = this.pb.userEmail;
  readonly authenticated = this.pb.authenticated;
  readonly configured = computed(() => this.pb.baseUrl().length > 0);
  private readonly statusSig = signal<SyncStatus>('off');
  readonly status = this.statusSig.asReadonly();
  private readonly lastSyncAtSig = signal<string | null>(null);
  readonly lastSyncAt = this.lastSyncAtSig.asReadonly();
  private readonly lastErrorSig = signal<string | null>(null);
  readonly lastError = this.lastErrorSig.asReadonly();
  private inFlight = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    window.addEventListener('online', () => void this.syncNow());
    window.addEventListener('offline', () => this.refreshIdleStatus());
    void this.start();
  }

  async setServerUrl(url: string): Promise<void> {
    this.pb.setBaseUrl(url);
    this.lastErrorSig.set(null);
    if (this.configured()) {
      this.startTimer();
      await this.syncNow();
    } else {
      this.stopTimer();
      this.refreshIdleStatus();
    }
  }

  async login(email: string, password: string): Promise<void> {
    await this.pb.login(email, password);
    localStorage.removeItem(SIGNED_OUT_KEY);
    void ensurePersistentStorage();
    this.lastErrorSig.set(null);
    this.startTimer();
    await this.syncNow();
  }

  signOut(): void {
    this.pb.logout();
    localStorage.setItem(SIGNED_OUT_KEY, '1');
    this.stopTimer();
    this.refreshIdleStatus();
  }

  async syncNow(): Promise<void> {
    if (!this.canSync() || this.inFlight) return;
    this.inFlight = true;
    this.statusSig.set('syncing');
    try {
      for (const collection of PULL_ORDER) {
        await this.pullCollection(collection);
      }
      await this.pushPending();

      this.statusSig.set('photos');
      await this.runPhotoTasks();

      this.lastSyncAtSig.set(await this.store.lastSyncAt());
      this.lastErrorSig.set(null);
      this.statusSig.set('idle');
    } catch (err) {
      this.handleFailure(err);
    } finally {
      this.inFlight = false;
    }
  }

  async fullResync(): Promise<void> {
    if (!this.configured()) return;
    await this.store.clearCursors();
    await this.store.markEverythingPending();
    this.lastSyncAtSig.set(null);
    await this.syncNow();
  }

  private async start(): Promise<void> {
    this.lastSyncAtSig.set(await this.store.lastSyncAt());
    this.refreshIdleStatus();
    if (!this.configured()) return;
    await this.pb.refreshAuth();
    this.startTimer();
    await this.syncNow();
  }

  private async pullCollection(collection: string): Promise<void> {
    let cursor: Cursor = await this.store.getCursor(collection);
    for (;;) {
      const page = await this.pb.listChanged(collection, cursor);
      if (!page.records.length) return;
      await this.mergePage(collection, page.records);

      const last = page.records.at(-1)!;
      await this.store.setCursor(collection, last['updated'] as string, last.id);
      if (!page.next) return;
      cursor = page.next;
    }
  }

  private async mergePage(collection: string, records: RecordModel[]): Promise<void> {
    switch (collection) {
      case COLLECTIONS.households:
        await this.store.mergeHouseholds(records.map(recordToHousehold));
        return;
      case COLLECTIONS.meters:
        await this.store.mergeMeters(records.map(recordToMeter));
        return;
      case COLLECTIONS.readings:
        await this.store.mergeReadings(records.map(recordToReading));
        await this.queueMissingPhotos(records);
        return;
    }
  }

  private async queueMissingPhotos(records: RecordModel[]): Promise<void> {
    for (const record of records) {
      const file = remotePhotoFile(record);
      const photoId = (record['photoId'] as string) || '';
      if (!file || !photoId) continue;
      if (await this.store.hasPhoto(photoId)) continue;
      await this.store.queuePhotoDownload(record.id, photoId, file);
    }
  }

  private async pushPending(): Promise<void> {
    const pending = await this.store.pendingRecords();
    for (const household of pending.households) {
      await this.pb.upsert(COLLECTIONS.households, household.id, householdToRecord(household));
      await this.store.clearPending(COLLECTIONS.households, household.id);
    }
    for (const meter of pending.meters) {
      await this.pb.upsert(COLLECTIONS.meters, meter.id, meterToRecord(meter));
      await this.store.clearPending(COLLECTIONS.meters, meter.id);
    }
    for (const reading of pending.readings) {
      await this.pb.upsert(COLLECTIONS.readings, reading.id, readingToRecord(reading));
      await this.store.clearPending(COLLECTIONS.readings, reading.id);
    }
  }

  private async runPhotoTasks(): Promise<void> {
    for (const task of await this.store.photoTasks()) {
      await this.runPhotoTask(task);
      await this.store.clearPhotoTask(task.readingId);
    }
  }

  private async runPhotoTask(task: PhotoTask): Promise<void> {
    if (task.op === 'clear') {
      await this.pb.clearPhoto(task.readingId);
      return;
    }
    if (task.op === 'upload') {
      const photo = task.photoId ? await this.store.getPhoto(task.photoId) : undefined;
      if (!photo) return;
      await this.pb.uploadPhoto(
        task.readingId,
        photo.data,
        photoFilename(photo.id, photo.mimeType),
      );
      return;
    }
    if (!task.photoId || !task.remoteFile) return;
    const blob = await this.pb.downloadPhoto(task.readingId, task.remoteFile);
    await this.store.putPhoto({
      id: task.photoId,
      readingId: task.readingId,
      mimeType: blob.type || 'image/jpeg',
      data: blob,
      createdAt: new Date().toISOString(),
    });
  }

  private canSync(): boolean {
    if (!this.configured() || !this.pb.authenticated()) {
      this.refreshIdleStatus();
      return false;
    }
    if (!navigator.onLine) {
      this.statusSig.set('offline');
      return false;
    }
    return true;
  }

  private refreshIdleStatus(): void {
    if (!this.configured()) {
      this.statusSig.set('off');
      return;
    }
    if (!this.pb.authenticated()) {
      this.statusSig.set(localStorage.getItem(SIGNED_OUT_KEY) ? 'off' : 'needsAuth');
      return;
    }
    this.statusSig.set(navigator.onLine ? 'idle' : 'offline');
  }

  private handleFailure(err: unknown): void {
    if (isAuthError(err)) {
      this.pb.logout();
      this.statusSig.set('needsAuth');
      this.lastErrorSig.set('Session expired. Sign in again to resume syncing.');
      return;
    }
    if (!navigator.onLine) {
      this.statusSig.set('offline');
      return;
    }
    this.statusSig.set('error');
    this.lastErrorSig.set(err instanceof Error ? err.message : String(err));
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => {
      if (navigator.onLine) void this.syncNow();
    }, SYNC_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
