/**
 * A household groups meters that belong together, typically one dwelling unit.
 * The `building` role marks the household whose meters measure the property as
 * a whole; its totals therefore overlap with those of the units.
 */
export type HouseholdRole = 'unit' | 'building';

export const HOUSEHOLD_ROLES: HouseholdRole[] = ['unit', 'building'];

export const HOUSEHOLD_ROLE_LABELS: Record<HouseholdRole, string> = {
  unit: 'Unit',
  building: 'Building total',
};

export interface Household {
  id: string;
  name: string;
  role: HouseholdRole;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type HouseholdInput = Pick<Household, 'name' | 'role'>;
