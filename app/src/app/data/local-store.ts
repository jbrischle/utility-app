import { Injectable, signal, Signal } from '@angular/core';
import { Table } from 'dexie';
import { db, PhotoTask } from './db';
import { Meter, MeterInput } from '../models/meter.model';
import { Reading, ReadingStoreInput } from '../models/reading.model';
import { PhotoInput } from '../models/photo.model';
import { Household, HouseholdInput } from '../models/household.model';
import { unitForType } from '../models/utility-type';
import { COLLECTIONS } from '../models/collections';
import { ensurePersistentStorage } from './persistent-storage';

/** Records written before v4 carry no `householdId`; treat them as unassigned. */
function normalizeMeter(meter: Meter): Meter {
  return { ...meter, householdId: meter.householdId ?? null };
}

export interface LocalChanges {
  meters: Meter[];
  readings: Reading[];
  households: Household[];
}

function isPresent<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

@Injectable({ providedIn: 'root' })
export class LocalStore {
  private readonly metersSig = signal<Meter[]>([]);
  readonly meters: Signal<Meter[]> = this.metersSig.asReadonly();
  private readonly readingsSig = signal<Reading[]>([]);
  readonly readings: Signal<Reading[]> = this.readingsSig.asReadonly();
  private readonly householdsSig = signal<Household[]>([]);
  readonly households: Signal<Household[]> = this.householdsSig.asReadonly();
  private readonly readySig = signal(false);
  readonly ready: Signal<boolean> = this.readySig.asReadonly();

  constructor() {
    void this.reloadAll();
  }

  getMeterById(id: string): Meter | undefined {
    return this.metersSig().find((m) => m.id === id);
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
    await this.markPending(COLLECTIONS.meters, meter.id);
    void ensurePersistentStorage();
    await this.reloadMeters();
    return meter;
  }

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
    await this.markPending(COLLECTIONS.meters, id);
    await this.reloadMeters();
  }

  async deleteMeter(id: string): Promise<void> {
    const ts = now();
    const meter = await db.meters.get(id);
    if (meter) {
      await db.meters.put({ ...meter, deletedAt: ts, updatedAt: ts });
      await this.markPending(COLLECTIONS.meters, id);
    }
    const readings = await db.readings.where('meterId').equals(id).toArray();
    const deleted = readings.filter((r) => !r.deletedAt);
    await db.readings.bulkPut(deleted.map((r) => ({ ...r, deletedAt: ts, updatedAt: ts })));
    await db.pending.bulkPut(
      deleted.map((r) => ({ collection: COLLECTIONS.readings, recordId: r.id })),
    );
    await this.reloadAll();
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
    await this.markPending(COLLECTIONS.households, household.id);
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
    await this.markPending(COLLECTIONS.households, id);
    await this.reloadHouseholds();
  }

  async deleteHousehold(id: string): Promise<void> {
    const existing = await db.households.get(id);
    if (!existing) return;
    const ts = now();
    await db.households.put({ ...existing, deletedAt: ts, updatedAt: ts });
    await this.markPending(COLLECTIONS.households, id);
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
      await this.queuePhotoUpload(reading.id, photoId);
    }
    await db.readings.put(reading);
    await this.markPending(COLLECTIONS.readings, reading.id);
    void ensurePersistentStorage();
    await this.reloadReadings();
    return reading;
  }

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
        await this.queuePhotoUpload(id, photoId);
      } else {
        await db.photoTasks.put({ readingId: id, op: 'clear', photoId: null, remoteFile: null });
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
    await this.markPending(COLLECTIONS.readings, id);
    await this.reloadReadings();
  }

  async deleteReading(id: string): Promise<void> {
    const existing = await db.readings.get(id);
    if (!existing) return;
    const ts = now();
    await db.readings.put({ ...existing, deletedAt: ts, updatedAt: ts });
    await this.markPending(COLLECTIONS.readings, id);
    await this.reloadReadings();
  }

  async getPhoto(id: string): Promise<PhotoInput | undefined> {
    return db.photos.get(id);
  }

  async pendingRecords(): Promise<LocalChanges> {
    const rows = await db.pending.toArray();
    const byCollection = new Map<string, string[]>();
    for (const row of rows) {
      const ids = byCollection.get(row.collection);
      if (ids) ids.push(row.recordId);
      else byCollection.set(row.collection, [row.recordId]);
    }
    const [meters, readings, households] = await Promise.all([
      db.meters.bulkGet(byCollection.get(COLLECTIONS.meters) ?? []),
      db.readings.bulkGet(byCollection.get(COLLECTIONS.readings) ?? []),
      db.households.bulkGet(byCollection.get(COLLECTIONS.households) ?? []),
    ]);
    return {
      meters: meters.filter(isPresent).map(normalizeMeter),
      readings: readings.filter(isPresent).map((r) => ({ ...r, produced: r.produced ?? null })),
      households: households.filter(isPresent),
    };
  }

  async clearPending(collection: string, recordId: string): Promise<void> {
    await db.pending.delete([collection, recordId]);
  }

  async markEverythingPending(): Promise<void> {
    const [meterIds, readingIds, householdIds] = await Promise.all([
      db.meters.toCollection().primaryKeys() as Promise<string[]>,
      db.readings.toCollection().primaryKeys() as Promise<string[]>,
      db.households.toCollection().primaryKeys() as Promise<string[]>,
    ]);
    await db.pending.bulkPut([
      ...householdIds.map((recordId) => ({ collection: COLLECTIONS.households, recordId })),
      ...meterIds.map((recordId) => ({ collection: COLLECTIONS.meters, recordId })),
      ...readingIds.map((recordId) => ({ collection: COLLECTIONS.readings, recordId })),
    ]);
    const readings = await db.readings.toArray();
    await db.photoTasks.bulkPut(
      readings
        .filter((r) => r.photoId)
        .map((r) => ({
          readingId: r.id,
          op: 'upload' as const,
          photoId: r.photoId,
          remoteFile: null,
        })),
    );
  }

  async mergeMeters(remote: Meter[]): Promise<number> {
    return this.mergeInto(db.meters, COLLECTIONS.meters, remote, normalizeMeter);
  }

  async mergeReadings(remote: Reading[]): Promise<number> {
    return this.mergeInto(db.readings, COLLECTIONS.readings, remote, (r) => ({
      ...r,
      produced: r.produced ?? null,
    }));
  }

  async mergeHouseholds(remote: Household[]): Promise<number> {
    return this.mergeInto(db.households, COLLECTIONS.households, remote, (h) => h);
  }

  async photoTasks(): Promise<PhotoTask[]> {
    return db.photoTasks.toArray();
  }

  async queuePhotoDownload(readingId: string, photoId: string, remoteFile: string): Promise<void> {
    await db.photoTasks.put({ readingId, op: 'download', photoId, remoteFile });
  }

  async clearPhotoTask(readingId: string): Promise<void> {
    await db.photoTasks.delete(readingId);
  }

  async hasPhoto(photoId: string): Promise<boolean> {
    return (await db.photos.get(photoId)) !== undefined;
  }

  async putPhoto(photo: PhotoInput): Promise<void> {
    const existing = await db.photos.get(photo.id);
    if (!existing) await db.photos.put(photo);
  }

  async getCursor(collection: string): Promise<{ updated: string | null; id: string | null }> {
    const state = await db.syncState.get(collection);
    return { updated: state?.updated ?? null, id: state?.id ?? null };
  }

  async setCursor(collection: string, updated: string, id: string): Promise<void> {
    await db.syncState.put({ key: collection, updated, id });
  }

  async lastSyncAt(): Promise<string | null> {
    const states = await db.syncState.toArray();
    const stamps = states.map((s) => s.updated).filter(isPresent);
    return stamps.length ? stamps.sort().at(-1)! : null;
  }

  async clearCursors(): Promise<void> {
    await db.syncState.clear();
  }

  private async mergeInto<T extends { id: string; updatedAt: string }>(
    table: Table<T, string>,
    collection: string,
    remote: T[],
    normalize: (record: T) => T,
  ): Promise<number> {
    const puts: T[] = [];
    for (const incoming of remote) {
      const local = await table.get(incoming.id);
      if (!local || incoming.updatedAt > local.updatedAt) puts.push(normalize(incoming));
    }
    if (!puts.length) return 0;
    await table.bulkPut(puts);
    await db.pending.bulkDelete(puts.map((r) => [collection, r.id] as [string, string]));
    await this.reloadAll();
    return puts.length;
  }

  private async queuePhotoUpload(readingId: string, photoId: string): Promise<void> {
    await db.photoTasks.put({ readingId, op: 'upload', photoId, remoteFile: null });
  }

  private async markPending(collection: string, recordId: string): Promise<void> {
    await db.pending.put({ collection, recordId });
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
