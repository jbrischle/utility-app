import Dexie, { Table } from 'dexie';
import { Meter } from '../models/meter.model';
import { Reading } from '../models/reading.model';
import { PhotoInput } from '../models/photo.model';
import { Household } from '../models/household.model';

export interface SyncCursor {
  key: string;
  updated: string | null;
  id: string | null;
}

export interface PendingPush {
  collection: string;
  recordId: string;
}

/** Photo blob transfer owed to the server, or to this device. */
export interface PhotoTask {
  readingId: string;
  op: 'upload' | 'download' | 'clear';
  photoId: string | null;
  /** Server-side filename; only set for downloads. */
  remoteFile: string | null;
}

export class MeterTrackerDb extends Dexie {
  meters!: Table<Meter, string>;
  readings!: Table<Reading, string>;
  photos!: Table<PhotoInput, string>;
  syncState!: Table<SyncCursor, string>;
  households!: Table<Household, string>;
  pending!: Table<PendingPush, [string, string]>;
  photoTasks!: Table<PhotoTask, string>;

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
    this.version(4)
      .stores({
        meters: 'id, type, householdId, updatedAt, deletedAt',
        readings: 'id, meterId, readAt, updatedAt, deletedAt',
        photos: 'id, readingId',
        syncState: 'key',
        households: 'id, updatedAt, deletedAt',
      })
      .upgrade((tx) =>
        tx
          .table('meters')
          .toCollection()
          .modify((meter: Record<string, unknown>) => {
            // Leaves updatedAt untouched so this does not churn the sync cursor.
            meter['householdId'] ??= null;
          }),
      );
    this.version(5)
      .stores({
        meters: 'id, type, householdId, updatedAt, deletedAt',
        readings: 'id, meterId, readAt, updatedAt, deletedAt',
        photos: 'id, readingId',
        syncState: 'key',
        households: 'id, updatedAt, deletedAt',
        pending: '[collection+recordId], collection',
        photoTasks: 'readingId',
      })
      .upgrade(async (tx) => {
        // Rows here were cursors for the old custom sync server, keyed by its
        // URL and carrying its clock. Reusing one against PocketBase would make
        // the first pull skip everything older than a timestamp from a
        // different machine -- silently, and permanently. Starting from null is
        // correct: the first sync is a full reconcile in both directions.
        await tx.table('syncState').clear();
        // Everything local predates the first push, so all of it is pending.
        const pending = tx.table('pending');
        for (const [table, collection] of [
          ['households', 'utility_households'],
          ['meters', 'utility_meters'],
          ['readings', 'utility_readings'],
        ] as const) {
          const ids = (await tx.table(table).toCollection().primaryKeys()) as string[];
          await pending.bulkPut(ids.map((recordId) => ({ collection, recordId })));
        }
        // Local photos have never been uploaded either.
        const readings = (await tx.table('readings').toArray()) as Reading[];
        await tx.table('photoTasks').bulkPut(
          readings
            .filter((r) => r.photoId)
            .map((r) => ({
              readingId: r.id,
              op: 'upload' as const,
              photoId: r.photoId,
              remoteFile: null,
            })),
        );
      });
  }
}

export const db = new MeterTrackerDb();
