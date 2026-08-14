import { RecordModel } from 'pocketbase';
import { Meter } from '../models/meter.model';
import { Reading } from '../models/reading.model';
import { Household, HouseholdRole } from '../models/household.model';
import { UtilityType } from '../models/utility-type';

function text(value: string | null): string {
  return value ?? '';
}

function nullable(value: unknown): string | null {
  const str = (value as string | undefined) ?? '';
  return str === '' ? null : str;
}

export function householdToRecord(household: Household): Record<string, unknown> {
  return {
    name: household.name,
    role: household.role,
    createdAt: household.createdAt,
    updatedAt: household.updatedAt,
    deletedAt: text(household.deletedAt),
  };
}

export function recordToHousehold(record: RecordModel): Household {
  return {
    id: record.id,
    name: (record['name'] as string) ?? '',
    role: (record['role'] as HouseholdRole) ?? 'unit',
    createdAt: (record['createdAt'] as string) ?? '',
    updatedAt: (record['updatedAt'] as string) ?? '',
    deletedAt: nullable(record['deletedAt']),
  };
}

export function meterToRecord(meter: Meter): Record<string, unknown> {
  return {
    name: meter.name,
    type: meter.type,
    unit: meter.unit,
    location: meter.location,
    serialNumber: meter.serialNumber,
    notes: meter.notes,
    householdId: text(meter.householdId),
    createdAt: meter.createdAt,
    updatedAt: meter.updatedAt,
    deletedAt: text(meter.deletedAt),
  };
}

export function recordToMeter(record: RecordModel): Meter {
  return {
    id: record.id,
    name: (record['name'] as string) ?? '',
    type: (record['type'] as UtilityType) ?? 'electricity',
    unit: (record['unit'] as string) ?? '',
    location: (record['location'] as string) ?? '',
    serialNumber: (record['serialNumber'] as string) ?? '',
    notes: (record['notes'] as string) ?? '',
    householdId: nullable(record['householdId']),
    createdAt: (record['createdAt'] as string) ?? '',
    updatedAt: (record['updatedAt'] as string) ?? '',
    deletedAt: nullable(record['deletedAt']),
  };
}

export function readingToRecord(reading: Reading): Record<string, unknown> {
  return {
    meterId: reading.meterId,
    consumed: reading.consumed,
    produced: reading.produced ?? 0,
    producedTracked: reading.produced !== null,
    readAt: reading.readAt,
    note: reading.note,
    photoId: text(reading.photoId),
    createdAt: reading.createdAt,
    updatedAt: reading.updatedAt,
    deletedAt: text(reading.deletedAt),
  };
}

export function recordToReading(record: RecordModel): Reading {
  return {
    id: record.id,
    meterId: (record['meterId'] as string) ?? '',
    consumed: (record['consumed'] as number) ?? 0,
    produced: record['producedTracked'] ? ((record['produced'] as number) ?? 0) : null,
    readAt: (record['readAt'] as string) ?? '',
    note: (record['note'] as string) ?? '',
    photoId: nullable(record['photoId']),
    createdAt: (record['createdAt'] as string) ?? '',
    updatedAt: (record['updatedAt'] as string) ?? '',
    deletedAt: nullable(record['deletedAt']),
  };
}

export function remotePhotoFile(record: RecordModel): string | null {
  return nullable(record['photo']);
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function photoFilename(photoId: string, mimeType: string): string {
  return `${photoId}.${EXTENSIONS[mimeType] ?? 'jpg'}`;
}
