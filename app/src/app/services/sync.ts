import { Injectable, computed, inject, signal } from '@angular/core';
import { LocalStore } from '../data/local-store';
import { Meter } from '../models/meter.model';
import { Reading } from '../models/reading.model';
import { Household } from '../models/household.model';

export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'offline' | 'error';

const SERVER_URL_KEY = 'meter-tracker.serverUrl';
/** Periodic background sync interval while online and enabled. */
const SYNC_INTERVAL_MS = 60_000;

interface ChangesResponse {
  serverTime: string;
  meters: Meter[];
  readings: Reading[];
  households?: Household[];
}

/**
 * Sync engine (Phase 2). Reconciles the local IndexedDB store with a self-hosted
 * server using last-write-wins by `updatedAt`. It depends only on `LocalStore`
 * and `fetch`; Phase 1 data flows are untouched. With no server URL configured,
 * sync is disabled and the app behaves exactly as in Phase 1.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly store = inject(LocalStore);

  private readonly serverUrlSig = signal<string>(readStoredServerUrl());
  private readonly statusSig = signal<SyncStatus>(readStoredServerUrl() ? 'idle' : 'disabled');
  private readonly lastSyncAtSig = signal<string | null>(null);
  private readonly lastErrorSig = signal<string | null>(null);

  /** Configured server base URL (empty string = sync disabled). */
  readonly serverUrl = this.serverUrlSig.asReadonly();
  readonly status = this.statusSig.asReadonly();
  readonly lastSyncAt = this.lastSyncAtSig.asReadonly();
  readonly lastError = this.lastErrorSig.asReadonly();
  readonly enabled = computed(() => this.serverUrlSig().length > 0);

  private inFlight = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    window.addEventListener('online', () => void this.syncNow());
    window.addEventListener('offline', () => {
      if (this.enabled()) this.statusSig.set('offline');
    });
    if (this.enabled()) {
      void this.refreshLastSyncAt();
      this.startTimer();
      void this.syncNow();
    }
  }

  /** Persists a new server URL and re-syncs (empty string disables sync). */
  async setServerUrl(url: string): Promise<void> {
    const normalized = normalizeUrl(url);
    this.serverUrlSig.set(normalized);
    if (normalized) {
      localStorage.setItem(SERVER_URL_KEY, normalized);
    } else {
      localStorage.removeItem(SERVER_URL_KEY);
    }
    this.lastErrorSig.set(null);
    if (normalized) {
      await this.refreshLastSyncAt();
      this.statusSig.set('idle');
      this.startTimer();
      await this.syncNow();
    } else {
      this.stopTimer();
      this.lastSyncAtSig.set(null);
      this.statusSig.set('disabled');
    }
  }

  /** Runs a full pull/push/photo reconcile. Safe to call repeatedly. */
  async syncNow(): Promise<void> {
    const base = this.serverUrlSig();
    if (!base) {
      this.statusSig.set('disabled');
      return;
    }
    if (this.inFlight) return;
    if (!navigator.onLine) {
      this.statusSig.set('offline');
      return;
    }

    this.inFlight = true;
    this.statusSig.set('syncing');
    try {
      const since = await this.store.getLastSyncAt(base);

      // 1. Pull remote changes and merge (last-write-wins).
      const pull = await this.getJson<ChangesResponse>(
        `${base}/sync/changes?since=${encodeURIComponent(since ?? '')}`,
      );
      await this.store.mergeRemote(pull.meters ?? [], pull.readings ?? [], pull.households ?? []);

      // 2. Push local changes since the last cursor.
      const local = await this.store.changedSince(since);
      if (local.meters.length || local.readings.length || local.households.length) {
        await this.postJson(`${base}/sync/changes`, {
          meters: local.meters,
          readings: local.readings,
          households: local.households,
        });
      }

      // 3. Reconcile photo blobs both directions.
      await this.syncPhotos(base);

      // 4. Advance the cursor to the server time observed at pull.
      await this.store.setLastSyncAt(base, pull.serverTime);
      this.lastSyncAtSig.set(pull.serverTime);
      this.lastErrorSig.set(null);
      this.statusSig.set('idle');
    } catch (err) {
      if (!navigator.onLine) {
        this.statusSig.set('offline');
      } else {
        this.statusSig.set('error');
        this.lastErrorSig.set(err instanceof Error ? err.message : String(err));
      }
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Drops the sync cursor and syncs again, so the whole local dataset is pushed
   * to the server. Needed after the server database has been rebuilt: without
   * it the next push would only carry recent changes and the server would stay
   * silently incomplete.
   */
  async fullResync(): Promise<void> {
    const base = this.serverUrlSig();
    if (!base) return;
    await this.store.clearLastSyncAt(base);
    this.lastSyncAtSig.set(null);
    await this.syncNow();
  }

  private async syncPhotos(base: string): Promise<void> {
    const [{ ids: serverIds }, localIds] = await Promise.all([
      this.getJson<{ ids: string[] }>(`${base}/photos/manifest`),
      this.store.allPhotoIds(),
    ]);
    const serverSet = new Set(serverIds ?? []);
    const localSet = new Set(localIds);

    // Upload local photos the server is missing.
    for (const id of localIds) {
      if (serverSet.has(id)) continue;
      const photo = await this.store.getPhoto(id);
      if (!photo) continue;
      const form = new FormData();
      form.append('id', photo.id);
      form.append('readingId', photo.readingId);
      form.append('mimeType', photo.mimeType);
      form.append('data', photo.data, `${photo.id}`);
      const res = await fetch(`${base}/photos`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
    }

    // Download referenced photos we don't have locally.
    for (const { photoId, readingId } of await this.store.referencedPhotos()) {
      if (localSet.has(photoId)) continue;
      const res = await fetch(`${base}/photos/${encodeURIComponent(photoId)}`);
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`Photo download failed (${res.status})`);
      const data = await res.blob();
      await this.store.putPhoto({
        id: photoId,
        readingId,
        mimeType: data.type || 'image/jpeg',
        data,
        createdAt: new Date().toISOString(),
      });
    }
  }

  private async refreshLastSyncAt(): Promise<void> {
    this.lastSyncAtSig.set(await this.store.getLastSyncAt(this.serverUrlSig()));
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

  private async getJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return (await res.json()) as T;
  }

  private async postJson(url: string, body: unknown): Promise<void> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
  }
}

function readStoredServerUrl(): string {
  try {
    return normalizeUrl(localStorage.getItem(SERVER_URL_KEY) ?? '');
  } catch {
    return '';
  }
}

/** Trims and removes any trailing slash so endpoints concatenate cleanly. */
function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
