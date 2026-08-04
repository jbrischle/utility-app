import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type {
  ApplyResult,
  Changes,
  Meter,
  PhotoInput,
  PhotoRow,
  Reading,
} from "./types.ts";

/**
 * SQLite storage for the sync server, backed by Node's built-in `node:sqlite`
 * module (no native build step required). The schema mirrors the shared data
 * model (see docs/prd/00-overview.md) plus the `produced` register used by
 * electricity meters. Ids are always the client-generated UUIDs; the server
 * never mints ids.
 */

type SqlValue = string | number | bigint | null | Uint8Array;
type BindParams = Record<string, SqlValue>;

const DB_PATH = process.env.DB_PATH || "./data/meters.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS meters (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL,
    unit         TEXT NOT NULL,
    location     TEXT NOT NULL DEFAULT '',
    serialNumber TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    createdAt    TEXT NOT NULL,
    updatedAt    TEXT NOT NULL,
    deletedAt    TEXT
  );

  CREATE TABLE IF NOT EXISTS readings (
    id        TEXT PRIMARY KEY,
    meterId   TEXT NOT NULL,
    value     REAL NOT NULL,
    produced  REAL,
    readAt    TEXT NOT NULL,
    note      TEXT NOT NULL DEFAULT '',
    photoId   TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    deletedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS photos (
    id        TEXT PRIMARY KEY,
    readingId TEXT NOT NULL,
    mimeType  TEXT NOT NULL,
    data      BLOB NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_meters_updatedAt   ON meters (updatedAt);
  CREATE INDEX IF NOT EXISTS idx_readings_updatedAt ON readings (updatedAt);
  CREATE INDEX IF NOT EXISTS idx_readings_meterId   ON readings (meterId);
`);

const METER_COLUMNS = [
  "id",
  "name",
  "type",
  "unit",
  "location",
  "serialNumber",
  "notes",
  "createdAt",
  "updatedAt",
  "deletedAt",
] as const;

const READING_COLUMNS = [
  "id",
  "meterId",
  "value",
  "produced",
  "readAt",
  "note",
  "photoId",
  "createdAt",
  "updatedAt",
  "deletedAt",
] as const;

function upsertStatement(table: string, columns: readonly string[]) {
  const cols = columns.join(", ");
  const placeholders = columns.map((c) => `@${c}`).join(", ");
  // Last-write-wins: only overwrite when the incoming updatedAt is newer or equal.
  const updates = columns
    .filter((c) => c !== "id")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  return db.prepare(`
    INSERT INTO ${table} (${cols}) VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET ${updates}
    WHERE excluded.updatedAt >= ${table}.updatedAt
  `);
}

const upsertMeterStmt = upsertStatement("meters", METER_COLUMNS);
const upsertReadingStmt = upsertStatement("readings", READING_COLUMNS);

const selectMetersSinceStmt = db.prepare(
  "SELECT * FROM meters WHERE updatedAt > ? ORDER BY updatedAt ASC",
);
const selectAllMetersStmt = db.prepare(
  "SELECT * FROM meters ORDER BY updatedAt ASC",
);
const selectReadingsSinceStmt = db.prepare(
  "SELECT * FROM readings WHERE updatedAt > ? ORDER BY updatedAt ASC",
);
const selectAllReadingsStmt = db.prepare(
  "SELECT * FROM readings ORDER BY updatedAt ASC",
);

function normalizeMeter(row: Record<string, unknown>): Meter {
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    type: String(row["type"]),
    unit: String(row["unit"]),
    location: (row["location"] as string) ?? "",
    serialNumber: (row["serialNumber"] as string) ?? "",
    notes: (row["notes"] as string) ?? "",
    createdAt: String(row["createdAt"]),
    updatedAt: String(row["updatedAt"]),
    deletedAt: (row["deletedAt"] as string | null) ?? null,
  };
}

function normalizeReading(row: Record<string, unknown>): Reading {
  return {
    id: String(row["id"]),
    meterId: String(row["meterId"]),
    value: Number(row["value"]),
    produced: row["produced"] == null ? null : Number(row["produced"]),
    readAt: String(row["readAt"]),
    note: (row["note"] as string) ?? "",
    photoId: (row["photoId"] as string | null) ?? null,
    createdAt: String(row["createdAt"]),
    updatedAt: String(row["updatedAt"]),
    deletedAt: (row["deletedAt"] as string | null) ?? null,
  };
}

/** Returns meters/readings changed strictly after `since` (or all when empty). */
export function getChanges(since: string | null): Changes {
  const meterRows = (
    since ? selectMetersSinceStmt.all(since) : selectAllMetersStmt.all()
  ) as Record<string, unknown>[];
  const readingRows = (
    since ? selectReadingsSinceStmt.all(since) : selectAllReadingsStmt.all()
  ) as Record<string, unknown>[];
  return {
    meters: meterRows.map(normalizeMeter),
    readings: readingRows.map(normalizeReading),
  };
}

function coerceMeter(m: Partial<Meter>): BindParams {
  return {
    id: String(m.id),
    name: m.name ?? "",
    type: m.type ?? "",
    unit: m.unit ?? "",
    location: m.location ?? "",
    serialNumber: m.serialNumber ?? "",
    notes: m.notes ?? "",
    createdAt: m.createdAt ?? "",
    updatedAt: m.updatedAt ?? "",
    deletedAt: m.deletedAt ?? null,
  };
}

function coerceReading(r: Partial<Reading>): BindParams {
  return {
    id: String(r.id),
    meterId: String(r.meterId),
    value: Number(r.value),
    produced: r.produced == null ? null : Number(r.produced),
    readAt: r.readAt ?? "",
    note: r.note ?? "",
    photoId: r.photoId ?? null,
    createdAt: r.createdAt ?? "",
    updatedAt: r.updatedAt ?? "",
    deletedAt: r.deletedAt ?? null,
  };
}

/**
 * Upserts incoming records using last-write-wins by `updatedAt`. Returns the
 * number of rows actually written (inserted or overwritten).
 */
export function applyChanges(
  meters: Partial<Meter>[] = [],
  readings: Partial<Reading>[] = [],
): ApplyResult {
  let meterCount = 0;
  let readingCount = 0;
  db.exec("BEGIN");
  try {
    for (const raw of meters) {
      if (!raw || !raw.id || !raw.updatedAt) continue;
      meterCount += Number(upsertMeterStmt.run(coerceMeter(raw)).changes);
    }
    for (const raw of readings) {
      if (!raw || !raw.id || !raw.updatedAt) continue;
      readingCount += Number(upsertReadingStmt.run(coerceReading(raw)).changes);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { meters: meterCount, readings: readingCount };
}

const insertPhotoStmt = db.prepare(`
  INSERT INTO photos (id, readingId, mimeType, data, createdAt)
  VALUES (@id, @readingId, @mimeType, @data, @createdAt)
  ON CONFLICT(id) DO NOTHING
`);
const selectPhotoStmt = db.prepare("SELECT * FROM photos WHERE id = ?");
const selectPhotoIdsStmt = db.prepare("SELECT id FROM photos ORDER BY id");
const photoExistsStmt = db.prepare(
  "SELECT 1 AS present FROM photos WHERE id = ?",
);

/** Stores a photo blob. No-op (idempotent) if the id already exists. */
export function savePhoto(photo: PhotoInput): void {
  const params: BindParams = {
    id: String(photo.id),
    readingId: String(photo.readingId ?? ""),
    mimeType: photo.mimeType || "image/jpeg",
    data: photo.data,
    createdAt: photo.createdAt || new Date().toISOString(),
  };
  insertPhotoStmt.run(params);
}

export function getPhoto(id: string): PhotoRow | undefined {
  const row = selectPhotoStmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const raw = row["data"];
  const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
  return {
    id: String(row["id"]),
    readingId: String(row["readingId"]),
    mimeType: String(row["mimeType"]),
    createdAt: String(row["createdAt"]),
    data,
  };
}

export function photoExists(id: string): boolean {
  return !!photoExistsStmt.get(id);
}

export function getPhotoIds(): string[] {
  const rows = selectPhotoIdsStmt.all() as Record<string, unknown>[];
  return rows.map((row) => String(row["id"]));
}
