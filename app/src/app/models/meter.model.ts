import { UtilityType } from './utility-type';

export interface Meter {
  id: string;
  name: string;
  type: UtilityType;
  unit: string;
  location: string;
  serialNumber: string;
  notes: string;
  /** Household this meter belongs to, or null when unassigned. */
  householdId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type MeterInput = Pick<
  Meter,
  'name' | 'type' | 'location' | 'serialNumber' | 'notes' | 'householdId'
>;
