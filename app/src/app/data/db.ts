import Dexie, { Table } from 'dexie';
import { Meter } from '../models/meter.model';
import { Reading } from '../models/reading.model';
import { PhotoBlob } from '../models/photo.model';

/**
 * IndexedDB schema for the Meter Tracker app.
 *
 * The `updatedAt` / `deletedAt` fields are indexed so a future sync engine
 * (Phase 2) can efficiently query records changed since a cursor. Phase 1 only
 * needs `id`, `meterId` and `readAt`, but indexing the sync fields now keeps the
 * schema stable across phases.
 */
export class MeterTrackerDb extends Dexie {
  meters!: Table<Meter, string>;
  readings!: Table<Reading, string>;
  photos!: Table<PhotoBlob, string>;

  constructor() {
    super('meter-tracker');
    this.version(1).stores({
      meters: 'id, type, updatedAt, deletedAt',
      readings: 'id, meterId, readAt, updatedAt, deletedAt',
      photos: 'id, readingId',
    });
  }
}

export const db = new MeterTrackerDb();
