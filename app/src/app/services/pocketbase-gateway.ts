import { Injectable, signal } from '@angular/core';
import PocketBase, { ClientResponseError, RecordModel } from 'pocketbase';
import { COLLECTIONS } from '../models/collections';

const SERVER_URL_KEY = 'meter-tracker.serverUrl';
const PAGE_SIZE = 200;

export interface Cursor {
  updated: string | null;
  id: string | null;
}

export interface ChangedPage {
  records: RecordModel[];
  next: Cursor | null;
}

@Injectable({ providedIn: 'root' })
export class PocketBaseGateway {
  private readonly pb = new PocketBase(readStoredServerUrl() || undefined);

  private readonly baseUrlSig = signal(readStoredServerUrl());
  /** Configured PocketBase base URL; empty string means sync is not set up. */
  readonly baseUrl = this.baseUrlSig.asReadonly();
  private readonly authedSig = signal(false);
  readonly authenticated = this.authedSig.asReadonly();
  private readonly emailSig = signal<string | null>(null);
  readonly userEmail = this.emailSig.asReadonly();

  constructor() {
    this.pb.autoCancellation(false);
    this.pb.authStore.onChange(() => this.readAuthState(), true);
  }

  setBaseUrl(url: string): void {
    const normalized = normalizeUrl(url);
    this.pb.baseURL = normalized;
    this.baseUrlSig.set(normalized);
    if (normalized) localStorage.setItem(SERVER_URL_KEY, normalized);
    else localStorage.removeItem(SERVER_URL_KEY);
  }

  async login(email: string, password: string): Promise<void> {
    await this.pb.collection(COLLECTIONS.users).authWithPassword(email, password);
  }

  logout(): void {
    this.pb.authStore.clear();
  }

  async refreshAuth(): Promise<void> {
    if (!this.pb.authStore.isValid) return;
    try {
      await this.pb.collection(COLLECTIONS.users).authRefresh();
    } catch (err) {
      if (isAuthError(err)) this.pb.authStore.clear();
    }
  }

  async listChanged(collection: string, cursor: Cursor): Promise<ChangedPage> {
    const records = await this.pb.collection(collection).getList(1, PAGE_SIZE, {
      filter: this.changedFilter(cursor),
      sort: 'updated,id',
      skipTotal: true,
    });
    const last = records.items.at(-1);
    return {
      records: records.items,
      next:
        records.items.length === PAGE_SIZE && last
          ? { updated: last['updated'] as string, id: last.id }
          : null,
    };
  }

  async upsert(collection: string, id: string, body: Record<string, unknown>): Promise<void> {
    try {
      await this.pb.collection(collection).create({ id, ...body });
    } catch (err) {
      if (!isDuplicateId(err)) throw err;
      await this.pb.collection(collection).update(id, body);
    }
  }

  async uploadPhoto(readingId: string, blob: Blob, filename: string): Promise<void> {
    const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
    await this.pb.collection(COLLECTIONS.readings).update(readingId, { photo: file });
  }

  async clearPhoto(readingId: string): Promise<void> {
    await this.pb.collection(COLLECTIONS.readings).update(readingId, { photo: '' });
  }

  async downloadPhoto(readingId: string, filename: string): Promise<Blob> {
    const url = [
      this.pb.baseURL,
      'api/files',
      COLLECTIONS.readings,
      encodeURIComponent(readingId),
      encodeURIComponent(filename),
    ].join('/');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Photo download failed (${res.status})`);
    return res.blob();
  }

  private changedFilter(cursor: Cursor): string {
    if (!cursor.updated) return '';
    return this.pb.filter('updated > {:u} || (updated = {:u} && id > {:i})', {
      u: cursor.updated,
      i: cursor.id ?? '',
    });
  }

  private readAuthState(): void {
    this.authedSig.set(this.pb.authStore.isValid);
    const record = this.pb.authStore.record;
    this.emailSig.set((record?.['email'] as string | undefined) ?? null);
  }
}

export function isAuthError(err: unknown): boolean {
  return err instanceof ClientResponseError && (err.status === 401 || err.status === 403);
}

function isDuplicateId(err: unknown): boolean {
  if (!(err instanceof ClientResponseError) || err.status !== 400) return false;
  const idError = (err.response?.['data'] as Record<string, { code?: string }> | undefined)?.['id'];
  return idError?.code === 'validation_pk_invalid';
}

function readStoredServerUrl(): string {
  try {
    return normalizeUrl(localStorage.getItem(SERVER_URL_KEY) ?? '');
  } catch {
    return '';
  }
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
