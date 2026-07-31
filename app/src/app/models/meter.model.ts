import { UtilityType } from './utility-type';

export interface Meter {
  id: string;
  name: string;
  type: UtilityType;
  unit: string;
  location: string;
  serialNumber: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type MeterInput = Pick<
  Meter,
  'name' | 'type' | 'location' | 'serialNumber' | 'notes'
>;
