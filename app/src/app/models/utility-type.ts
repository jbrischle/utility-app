export type UtilityType = 'electricity' | 'water';

export const UTILITY_TYPES: UtilityType[] = ['electricity', 'water'];

export const UTILITY_UNITS: Record<UtilityType, string> = {
  electricity: 'kWh',
  water: 'm³',
};

export const UTILITY_LABELS: Record<UtilityType, string> = {
  electricity: 'Electricity',
  water: 'Water',
};

export function unitForType(type: UtilityType): string {
  return UTILITY_UNITS[type];
}
