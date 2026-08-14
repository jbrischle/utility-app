/** PocketBase collection names, shared by the gateway and the local store. */
export const COLLECTIONS = {
  users: 'utility_users',
  households: 'utility_households',
  meters: 'utility_meters',
  readings: 'utility_readings',
} as const;

/**
 * Pull order matters: meters reference a household and readings reference a
 * meter, so pulling parents first means a merged child never briefly points at
 * something this device has not seen yet.
 */
export const PULL_ORDER = [
  COLLECTIONS.households,
  COLLECTIONS.meters,
  COLLECTIONS.readings,
] as const;
