import { describe, expect, it } from 'vitest';
import { RecordModel } from 'pocketbase';
import { Reading } from '../models/reading.model';
import { Meter } from '../models/meter.model';
import {
  meterToRecord,
  photoFilename,
  readingToRecord,
  recordToMeter,
  recordToReading,
  remotePhotoFile,
} from './sync-mapping';

function record(fields: Record<string, unknown>): RecordModel {
  return {
    id: 'r1',
    collectionId: 'c',
    collectionName: 'utility_readings',
    ...fields,
  } as RecordModel;
}

const reading: Reading = {
  id: 'r1',
  meterId: 'm1',
  consumed: 120,
  produced: null,
  readAt: '2026-08-01',
  note: 'hi',
  photoId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  deletedAt: null,
};

describe('sync mapping', () => {
  it('keeps produced null distinguishable from produced zero', () => {
    // PocketBase number fields cannot store null, so an untracked meter would
    // otherwise come back as 0 and the dashboard would start showing a
    // production total for water.
    const untracked = readingToRecord(reading);
    expect(untracked['produced']).toBe(0);
    expect(untracked['producedTracked']).toBe(false);
    expect(recordToReading(record(untracked)).produced).toBeNull();

    const zero = readingToRecord({ ...reading, produced: 0 });
    expect(zero['producedTracked']).toBe(true);
    expect(recordToReading(record(zero)).produced).toBe(0);
  });

  it('round-trips nullable text as empty string', () => {
    const deleted = readingToRecord({ ...reading, deletedAt: '2026-08-02T00:00:00.000Z' });
    expect(deleted['deletedAt']).toBe('2026-08-02T00:00:00.000Z');
    expect(readingToRecord(reading)['deletedAt']).toBe('');
    expect(recordToReading(record({ deletedAt: '' })).deletedAt).toBeNull();

    const meter: Meter = {
      id: 'm1',
      name: 'Kitchen',
      type: 'water',
      unit: 'm³',
      location: '',
      serialNumber: '',
      notes: '',
      householdId: null,
      createdAt: 'a',
      updatedAt: 'b',
      deletedAt: null,
    };
    expect(meterToRecord(meter)['householdId']).toBe('');
    expect(recordToMeter(record({ householdId: '' })).householdId).toBeNull();
  });

  it('never sends the photo field with a record push', () => {
    // The file is owned by the photo pass. Including it here would wipe the
    // server's copy whenever a device that has the record, but not the blob,
    // pushes an edit.
    expect(readingToRecord({ ...reading, photoId: 'p1' })).not.toHaveProperty('photo');
    expect(readingToRecord({ ...reading, photoId: 'p1' })['photoId']).toBe('p1');
  });

  it('reads the remote photo filename, treating empty as absent', () => {
    expect(remotePhotoFile(record({ photo: 'p1.jpg' }))).toBe('p1.jpg');
    expect(remotePhotoFile(record({ photo: '' }))).toBeNull();
  });

  it('names uploads with an extension PocketBase will accept', () => {
    expect(photoFilename('p1', 'image/png')).toBe('p1.png');
    expect(photoFilename('p1', 'image/webp')).toBe('p1.webp');
    expect(photoFilename('p1', '')).toBe('p1.jpg');
  });
});
