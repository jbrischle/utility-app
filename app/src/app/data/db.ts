import Dexie, { Table } from 'dexie';
import { Meter } from '../models/meter.model';
import { Reading } from '../models/reading.model';
import { PhotoInput } from '../models/photo.model';

/** Per-server sync cursor. `key` is the configured server URL. */
export interface SyncState {
  key: string;
  lastSyncAt: string | null;
}

/**
 * IndexedDB schema for the Meter Tracker app.
 *
 * The `updatedAt` / `deletedAt` fields are indexed so the sync engine (Phase 2)
 * can efficiently query records changed since a cursor. The `syncState` table
 * (added in v2) stores the `lastSyncAt` cursor per configured server URL.
 */
export class MeterTrackerDb extends Dexie {
  meters!: Table<Meter, string>;
  readings!: Table<Reading, string>;
  photos!: Table<PhotoInput, string>;
  syncState!: Table<SyncState, string>;

  constructor() {
    super('meter-tracker');
    this.version(1).stores({
      meters: 'id, type, updatedAt, deletedAt',
      readings: 'id, meterId, readAt, updatedAt, deletedAt',
      photos: 'id, readingId',
    });
    this.version(2).stores({
      meters: 'id, type, updatedAt, deletedAt',
      readings: 'id, meterId, readAt, updatedAt, deletedAt',
      photos: 'id, readingId',
      syncState: 'key',
    });
    this.version(3)
      .stores({
        meters: 'id, type, updatedAt, deletedAt',
        readings: 'id, meterId, readAt, updatedAt, deletedAt',
        photos: 'id, readingId',
        syncState: 'key',
      })
      .upgrade((tx) =>
        tx
          .table('readings')
          .toCollection()
          .modify((reading: Record<string, unknown>) => {
            if (reading['consumed'] === undefined) {
              reading['consumed'] = reading['value'] ?? 0;
            }
            delete reading['value'];
          }),
      );
  }
}

export const db = new MeterTrackerDb();
