/**
 * Shared record types for the sync server. These mirror the client's data model
 * (see app/src/app/models and docs/prd/00-overview.md) plus the `produced`
 * register used by electricity meters.
 */

export interface Meter {
  id: string;
  name: string;
  type: string;
  unit: string;
  location: string;
  serialNumber: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Reading {
  id: string;
  meterId: string;
  value: number;
  produced: number | null;
  readAt: string;
  note: string;
  photoId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PhotoInput {
  id: string;
  readingId: string;
  mimeType: string;
  data: Uint8Array;
  createdAt: string;
}

export interface PhotoRow extends PhotoInput {
  data: Buffer;
}

export interface Changes {
  meters: Meter[];
  readings: Reading[];
}

export interface ApplyResult {
  meters: number;
  readings: number;
}
