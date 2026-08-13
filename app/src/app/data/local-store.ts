import { computed, Injectable, signal, Signal } from '@angular/core';
import { db } from './db';
import { Meter, MeterInput } from '../models/meter.model';
import { Reading, ReadingStoreInput } from '../models/reading.model';
import { PhotoInput } from '../models/photo.model';
import { Household, HouseholdInput } from '../models/household.model';
import { unitForType } from '../models/utility-type';

/** Records written before v4 carry no `householdId`; treat them as unassigned. */
function normalizeMeter(meter: Meter): Meter {
  return { ...meter, householdId: meter.householdId ?? null };
}

export interface LocalChanges {
  meters: Meter[];
  readings: Reading[];
  households: Household[];
}

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Single source of truth for all persisted data. This is the ONLY module that
 * touches IndexedDB, so the Phase 2 sync engine can be layered on top without
 * changing any UI component.
 *
 * State is exposed as signals holding the non-deleted records. After every
 * mutation the affected signal is reloaded from the database, keeping the UI in
 * sync with what is actually persisted.
 */
@Injectable({ providedIn: 'root' })
export class LocalStore {
  private readonly metersSig = signal<Meter[]>([]);
  /** All non-deleted meters, sorted by name. */
  readonly meters: Signal<Meter[]> = this.metersSig.asReadonly();
  private readonly readingsSig = signal<Reading[]>([]);
  /** All non-deleted readings. */
  readonly readings: Signal<Reading[]> = this.readingsSig.asReadonly();
  private readonly householdsSig = signal<Household[]>([]);
  /** All non-deleted households, sorted by name. */
  readonly households: Signal<Household[]> = this.householdsSig.asReadonly();
  private readonly readySig = signal(false);
  /** True once the initial load from IndexedDB has completed. */
  readonly ready: Signal<boolean> = this.readySig.asReadonly();

  constructor() {
    void this.reloadAll();
  }

  getMeterById(id: string): Meter | undefined {
    return this.metersSig().find((m) => m.id === id);
  }

  meterSignal(id: string): Signal<Meter | undefined> {
    return computed(() => this.metersSig().find((m) => m.id === id));
  }

  async addMeter(input: MeterInput): Promise<Meter> {
    const ts = now();
    const meter: Meter = {
      id: uuid(),
      name: input.name.trim(),
      type: input.type,
      unit: unitForType(input.type),
      location: input.location.trim(),
      serialNumber: input.serialNumber.trim(),
      notes: input.notes.trim(),
      householdId: input.householdId,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    await db.meters.put(meter);
    await this.reloadMeters();
    return meter;
  }

  // ----- Meters -----------------------------------------------------------

  async updateMeter(id: string, input: MeterInput): Promise<void> {
    const existing = await db.meters.get(id);
    if (!existing) return;
    const updated: Meter = {
      ...existing,
      name: input.name.trim(),
      type: input.type,
      unit: unitForType(input.type),
      location: input.location.trim(),
      serialNumber: input.serialNumber.trim(),
      notes: input.notes.trim(),
      householdId: input.householdId,
      updatedAt: now(),
    };
    await db.meters.put(updated);
    await this.reloadMeters();
  }

  /** Soft-deletes a meter and all of its readings. */
  async deleteMeter(id: string): Promise<void> {
    const ts = now();
    const meter = await db.meters.get(id);
    if (meter) {
      await db.meters.put({ ...meter, deletedAt: ts, updatedAt: ts });
    }
    const readings = await db.readings.where('meterId').equals(id).toArray();
    await db.readings.bulkPut(
      readings.filter((r) => !r.deletedAt).map((r) => ({ ...r, deletedAt: ts, updatedAt: ts })),
    );
    await this.reloadAll();
  }

  // ----- Households -------------------------------------------------------

  getHouseholdById(id: string | null): Household | undefined {
    return id ? this.householdsSig().find((h) => h.id === id) : undefined;
  }

  async addHousehold(input: HouseholdInput): Promise<Household> {
    const ts = now();
    const household: Household = {
      id: uuid(),
      name: input.name.trim(),
      role: input.role,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    await db.households.put(household);
    await this.reloadHouseholds();
    return household;
  }

  async updateHousehold(id: string, input: HouseholdInput): Promise<void> {
    const existing = await db.households.get(id);
    if (!existing) return;
    await db.households.put({
      ...existing,
      name: input.name.trim(),
      role: input.role,
      updatedAt: now(),
    });
    await this.reloadHouseholds();
  }

  /**
   * Soft-deletes a household without touching its meters. They keep their
   * `householdId` and surface as unassigned, so undeleting restores the
   * grouping. Rewriting every meter here would clobber concurrent edits from
   * other devices under last-write-wins.
   */
  async deleteHousehold(id: string): Promise<void> {
    const existing = await db.households.get(id);
    if (!existing) return;
    const ts = now();
    await db.households.put({ ...existing, deletedAt: ts, updatedAt: ts });
    await this.reloadHouseholds();
  }

  readingsForMeter(meterId: string): Reading[] {
    return this.readingsSig()
      .filter((r) => r.meterId === meterId)
      .sort((a, b) => a.readAt.localeCompare(b.readAt));
  }

  async getReading(id: string): Promise<Reading | undefined> {
    const reading = await db.readings.get(id);
    return reading ? { ...reading, produced: reading.produced ?? null } : undefined;
  }

  async addReading(input: ReadingStoreInput, photo?: Blob): Promise<Reading> {
    const ts = now();
    let photoId: string | null = null;
    if (photo) {
      photoId = await this.savePhoto('', photo);
    }
    const reading: Reading = {
      id: uuid(),
      meterId: input.meterId,
      consumed: input.consumed,
      produced: input.produced,
      readAt: input.readAt,
      note: input.note.trim(),
      photoId,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    if (photoId) {
      await db.photos.update(photoId, { readingId: reading.id });
    }
    await db.readings.put(reading);
    await this.reloadReadings();
    return reading;
  }

  // ----- Readings ---------------------------------------------------------

  async updateReading(
    id: string,
    input: ReadingStoreInput,
    photoChange?: { photo: Blob | null },
  ): Promise<void> {
    const existing = await db.readings.get(id);
    if (!existing) return;
    let photoId = existing.photoId;
    if (photoChange) {
      if (existing.photoId) {
        await db.photos.delete(existing.photoId);
        photoId = null;
      }
      if (photoChange.photo) {
        photoId = await this.savePhoto(id, photoChange.photo);
      }
    }
    const updated: Reading = {
      ...existing,
      consumed: input.consumed,
      produced: input.produced,
      readAt: input.readAt,
      note: input.note.trim(),
      photoId,
      updatedAt: now(),
    };
    await db.readings.put(updated);
    await this.reloadReadings();
  }

  async deleteReading(id: string): Promise<void> {
    const existing = await db.readings.get(id);
    if (!existing) return;
    const ts = now();
    await db.readings.put({ ...existing, deletedAt: ts, updatedAt: ts });
    await this.reloadReadings();
  }

  async getPhoto(id: string): Promise<PhotoInput | undefined> {
    return db.photos.get(id);
  }

  // ----- Sync support -----------------------------------------------------
  // These methods exist so the Phase 2 SyncService can read/merge raw records
  // (including soft-deleted ones) without any UI component touching IndexedDB.

  /**
   * Raw records whose `updatedAt` is strictly after `since` (soft-deleted
   * records included). Passing `null` returns everything. Used to build the push
   * payload of local changes.
   */
  async changedSince(since: string | null): Promise<LocalChanges> {
    const [meters, readings, households] = await Promise.all([
      db.meters.toArray(),
      db.readings.toArray(),
      db.households.toArray(),
    ]);
    const normalizedMeters = meters.map(normalizeMeter);
    const normalizedReadings = readings.map((r) => ({ ...r, produced: r.produced ?? null }));
    if (!since) {
      return { meters: normalizedMeters, readings: normalizedReadings, households };
    }
    return {
      meters: normalizedMeters.filter((m) => m.updatedAt > since),
      readings: normalizedReadings.filter((r) => r.updatedAt > since),
      households: households.filter((h) => h.updatedAt > since),
    };
  }

  /**
   * Merges records pulled from the server using last-write-wins by `updatedAt`
   * (a remote record is applied only if it is strictly newer than the local one).
   * Returns how many records were actually written.
   */
  async mergeRemote(
    meters: Meter[],
    readings: Reading[],
    households: Household[] = [],
  ): Promise<{ meters: number; readings: number; households: number }> {
    const meterPuts: Meter[] = [];
    for (const remote of meters) {
      const local = await db.meters.get(remote.id);
      if (!local || remote.updatedAt > local.updatedAt) meterPuts.push(normalizeMeter(remote));
    }
    const readingPuts: Reading[] = [];
    for (const remote of readings) {
      const local = await db.readings.get(remote.id);
      if (!local || remote.updatedAt > local.updatedAt) {
        readingPuts.push({ ...remote, produced: remote.produced ?? null });
      }
    }
    const householdPuts: Household[] = [];
    for (const remote of households) {
      const local = await db.households.get(remote.id);
      if (!local || remote.updatedAt > local.updatedAt) householdPuts.push(remote);
    }
    if (meterPuts.length) await db.meters.bulkPut(meterPuts);
    if (readingPuts.length) await db.readings.bulkPut(readingPuts);
    if (householdPuts.length) await db.households.bulkPut(householdPuts);
    if (meterPuts.length || readingPuts.length || householdPuts.length) await this.reloadAll();
    return {
      meters: meterPuts.length,
      readings: readingPuts.length,
      households: householdPuts.length,
    };
  }

  /** Ids of all photo blobs stored locally. */
  async allPhotoIds(): Promise<string[]> {
    return (await db.photos.toCollection().primaryKeys()) as string[];
  }

  /** Photos referenced by any reading (including soft-deleted ones). */
  async referencedPhotos(): Promise<{ photoId: string; readingId: string }[]> {
    const readings = await db.readings.toArray();
    const seen = new Set<string>();
    const result: { photoId: string; readingId: string }[] = [];
    for (const r of readings) {
      if (r.photoId && !seen.has(r.photoId)) {
        seen.add(r.photoId);
        result.push({ photoId: r.photoId, readingId: r.id });
      }
    }
    return result;
  }

  /** Stores a photo blob if not already present (idempotent). */
  async putPhoto(photo: PhotoInput): Promise<void> {
    const existing = await db.photos.get(photo.id);
    if (!existing) await db.photos.put(photo);
  }

  async getLastSyncAt(serverUrl: string): Promise<string | null> {
    const state = await db.syncState.get(serverUrl);
    return state?.lastSyncAt ?? null;
  }

  async setLastSyncAt(serverUrl: string, lastSyncAt: string): Promise<void> {
    await db.syncState.put({ key: serverUrl, lastSyncAt });
  }

  /** Drops the cursor so the next sync pulls and pushes the full dataset. */
  async clearLastSyncAt(serverUrl: string): Promise<void> {
    await db.syncState.delete(serverUrl);
  }

  private async reloadAll(): Promise<void> {
    await Promise.all([this.reloadMeters(), this.reloadReadings(), this.reloadHouseholds()]);
    this.readySig.set(true);
  }

  private async reloadMeters(): Promise<void> {
    const all = await db.meters.toArray();
    const active = all
      .filter((m) => !m.deletedAt)
      .map(normalizeMeter)
      .sort((a, b) => a.name.localeCompare(b.name));
    this.metersSig.set(active);
  }

  private async reloadHouseholds(): Promise<void> {
    const all = await db.households.toArray();
    const active = all.filter((h) => !h.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
    this.householdsSig.set(active);
  }

  // ----- Photos -----------------------------------------------------------

  private async reloadReadings(): Promise<void> {
    const all = await db.readings.toArray();
    const active = all
      .filter((r) => !r.deletedAt)
      .map((r) => ({ ...r, produced: r.produced ?? null }))
      .sort((a, b) => a.readAt.localeCompare(b.readAt));
    this.readingsSig.set(active);
  }

  private async savePhoto(readingId: string, data: Blob): Promise<string> {
    const photo: PhotoInput = {
      id: uuid(),
      readingId,
      mimeType: data.type || 'image/jpeg',
      data,
      createdAt: now(),
    };
    await db.photos.put(photo);
    return photo.id;
  }
}
