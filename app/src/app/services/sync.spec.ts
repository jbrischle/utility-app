import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { RecordModel } from 'pocketbase';
import { SyncService } from './sync';
import { Cursor, PocketBaseGateway } from './pocketbase-gateway';
import { LocalStore } from '../data/local-store';
import { db } from '../data/db';
import { COLLECTIONS } from '../models/collections';

/**
 * In-memory stand-in for PocketBase. The split between this gateway and the
 * sync logic is what makes these tests possible: cursors, last-write-wins and
 * the photo queue are exercised without a server or a network.
 */
class FakeGateway {
  readonly baseUrl = signal('https://test.example');
  readonly authenticated = signal(true);
  readonly userEmail = signal<string | null>('a@b.c');

  /** collection -> id -> record, with `updated` acting as the server clock. */
  readonly records = new Map<string, Map<string, RecordModel>>();
  readonly photos = new Map<string, Blob>();
  readonly seenFilters: { collection: string; cursor: Cursor }[] = [];
  uploads: { readingId: string; filename: string }[] = [];
  cleared: string[] = [];

  seed(collection: string, record: Partial<RecordModel> & { id: string; updated: string }): void {
    const table = this.records.get(collection) ?? new Map();
    table.set(record.id, {
      collectionId: collection,
      collectionName: collection,
      ...record,
    } as RecordModel);
    this.records.set(collection, table);
  }

  setBaseUrl(url: string): void {
    this.baseUrl.set(url);
  }
  async login(): Promise<void> {
    this.authenticated.set(true);
  }
  logout(): void {
    this.authenticated.set(false);
  }
  async refreshAuth(): Promise<void> {}

  async listChanged(collection: string, cursor: Cursor) {
    this.seenFilters.push({ collection, cursor: { ...cursor } });
    const all = [...(this.records.get(collection)?.values() ?? [])].sort((a, b) =>
      `${a['updated']}|${a.id}`.localeCompare(`${b['updated']}|${b.id}`),
    );
    const after = cursor.updated
      ? all.filter((r) => `${r['updated']}|${r.id}` > `${cursor.updated}|${cursor.id ?? ''}`)
      : all;
    return { records: after, next: null };
  }

  async upsert(collection: string, id: string, body: Record<string, unknown>): Promise<void> {
    this.seed(collection, { id, updated: '2030-01-01 00:00:00.000Z', ...body } as never);
  }

  async uploadPhoto(readingId: string, blob: Blob, filename: string): Promise<void> {
    this.uploads.push({ readingId, filename });
    this.photos.set(filename, blob);
  }
  async clearPhoto(readingId: string): Promise<void> {
    this.cleared.push(readingId);
  }
  async downloadPhoto(_readingId: string, filename: string): Promise<Blob> {
    const blob = this.photos.get(filename);
    if (!blob) throw new Error(`no such file ${filename}`);
    return blob;
  }
}

function remoteReading(fields: Record<string, unknown>): Partial<RecordModel> & {
  id: string;
  updated: string;
} {
  return {
    id: 'r1',
    updated: '2026-01-01 00:00:00.000Z',
    meterId: 'm1',
    consumed: 10,
    produced: 0,
    producedTracked: false,
    readAt: '2026-01-01',
    note: '',
    photo: '',
    photoId: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: '',
    ...fields,
  } as never;
}

describe('SyncService', () => {
  let gateway: FakeGateway;
  let sync: SyncService;
  let store: LocalStore;

  beforeEach(async () => {
    // Only intervals are faked; updatedAt comparisons need a real clock.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await db.delete();
    await db.open();
    gateway = new FakeGateway();
    TestBed.configureTestingModule({
      providers: [{ provide: PocketBaseGateway, useValue: gateway }],
    });
    store = TestBed.inject(LocalStore);
    sync = TestBed.inject(SyncService);
    await sync.syncNow();
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('applies a remote record and keeps a newer local edit', async () => {
    const meter = await store.addMeter({
      name: 'Kitchen',
      type: 'water',
      location: '',
      serialNumber: '',
      notes: '',
      householdId: null,
    });

    // Remote edit is older than the local one, so the local name must survive.
    gateway.seed(COLLECTIONS.meters, {
      id: meter.id,
      updated: '2026-01-01 00:00:00.000Z',
      name: 'Stale',
      type: 'water',
      unit: 'm³',
      location: '',
      serialNumber: '',
      notes: '',
      householdId: '',
      createdAt: meter.createdAt,
      updatedAt: '2000-01-01T00:00:00.000Z',
      deletedAt: '',
    } as never);

    await sync.syncNow();
    expect(store.getMeterById(meter.id)?.name).toBe('Kitchen');

    // A remote edit that is genuinely newer wins.
    gateway.seed(COLLECTIONS.meters, {
      id: meter.id,
      updated: '2027-01-01 00:00:00.000Z',
      name: 'Renamed elsewhere',
      type: 'water',
      unit: 'm³',
      location: '',
      serialNumber: '',
      notes: '',
      householdId: '',
      createdAt: meter.createdAt,
      updatedAt: '2099-01-01T00:00:00.000Z',
      deletedAt: '',
    } as never);

    await sync.syncNow();
    expect(store.getMeterById(meter.id)?.name).toBe('Renamed elsewhere');
  });

  it('advances the cursor so the next pull asks only for newer records', async () => {
    gateway.seed(
      COLLECTIONS.readings,
      remoteReading({ id: 'r1', updated: '2026-05-05 10:00:00.000Z' }),
    );
    await sync.syncNow();

    const cursor = await store.getCursor(COLLECTIONS.readings);
    expect(cursor).toEqual({ updated: '2026-05-05 10:00:00.000Z', id: 'r1' });

    // The following sync must resume from there rather than re-reading history.
    await sync.syncNow();
    const readingPulls = gateway.seenFilters.filter((f) => f.collection === COLLECTIONS.readings);
    expect(readingPulls.at(-1)!.cursor).toEqual({
      updated: '2026-05-05 10:00:00.000Z',
      id: 'r1',
    });
  });

  it('pushes a local record once and then stops resending it', async () => {
    await store.addHousehold({ name: 'Ground floor', role: 'unit' });
    await sync.syncNow();

    expect(gateway.records.get(COLLECTIONS.households)?.size).toBe(1);
    const pendingAfter = await store.pendingRecords();
    expect(pendingAfter.households).toHaveLength(0);
  });

  it('drops a pending push when the remote version wins', async () => {
    const household = await store.addHousehold({ name: 'Mine', role: 'unit' });
    gateway.seed(COLLECTIONS.households, {
      id: household.id,
      updated: '2026-01-01 00:00:00.000Z',
      name: 'Theirs',
      role: 'unit',
      createdAt: household.createdAt,
      updatedAt: '2099-01-01T00:00:00.000Z',
      deletedAt: '',
    } as never);

    // Pull happens before push, so the losing local edit must not be sent back.
    await sync.syncNow();

    expect(store.households()[0].name).toBe('Theirs');
    expect(gateway.records.get(COLLECTIONS.households)?.get(household.id)?.['name']).toBe('Theirs');
  });

  it('propagates a soft delete instead of removing the record', async () => {
    const household = await store.addHousehold({ name: 'Gone', role: 'unit' });
    await sync.syncNow();
    await store.deleteHousehold(household.id);
    await sync.syncNow();

    const remote = gateway.records.get(COLLECTIONS.households)?.get(household.id);
    expect(remote?.['deletedAt']).toBeTruthy();
    expect(store.households()).toHaveLength(0);
  });

  it('uploads a local photo and downloads one it is missing', async () => {
    const meter = await store.addMeter({
      name: 'Meter',
      type: 'electricity',
      location: '',
      serialNumber: '',
      notes: '',
      householdId: null,
    });
    const blob = new Blob(['image-bytes'], { type: 'image/png' });
    const reading = await store.addReading(
      { meterId: meter.id, consumed: 1, produced: 2, readAt: '2026-01-01', note: '' },
      blob,
    );
    await sync.syncNow();

    expect(gateway.uploads).toHaveLength(1);
    expect(gateway.uploads[0].readingId).toBe(reading.id);
    expect(gateway.uploads[0].filename).toMatch(/\.png$/);

    // A second device sees the reading with a photo it has no blob for.
    const uploadedName = gateway.uploads[0].filename;
    await db.photos.clear();
    gateway.seed(
      COLLECTIONS.readings,
      remoteReading({
        id: 'remote-reading',
        updated: '2028-01-01 00:00:00.000Z',
        photo: uploadedName,
        photoId: 'photo-1',
        updatedAt: '2028-01-01T00:00:00.000Z',
      }),
    );

    await sync.syncNow();
    expect(await store.hasPhoto('photo-1')).toBe(true);
  });
});
