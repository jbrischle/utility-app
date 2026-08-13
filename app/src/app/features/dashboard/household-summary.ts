import { Household, HouseholdRole } from '../../models/household.model';
import { Meter } from '../../models/meter.model';
import { Reading } from '../../models/reading.model';
import {
  UTILITY_LABELS,
  UTILITY_TYPES,
  UTILITY_UNITS,
  UtilityType,
} from '../../models/utility-type';
import { CONSUMED, PRODUCED, UsageService } from '../../services/usage';

/**
 * Groups meters by household and totals their usage for the dashboard.
 *
 * A meter counts as unassigned when it has no `householdId` or when that id no
 * longer resolves to a live household — which happens by design, because
 * deleting a household deliberately leaves its meters untouched.
 */

/** Sentinel id of the bucket collecting meters without a live household. */
export const UNASSIGNED_ID = '__unassigned__';

export interface UsageRow {
  type: UtilityType;
  label: string;
  unit: string;
  consumed: number;
  /** Fed-in total, or null when this household records no production at all. */
  produced: number | null;
}

export interface HouseholdSummary {
  id: string;
  name: string;
  /** Null for the unassigned bucket, which is not a real household. */
  role: HouseholdRole | null;
  rows: UsageRow[];
  meters: Meter[];
}

/** Rolling window: the same date one year ago up to, but excluding, today. */
export function rollingYear(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
    to: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
  };
}

function roleRank(role: HouseholdRole | null): number {
  if (role === 'unit') return 0;
  return role === 'building' ? 1 : 2;
}

export function buildHouseholdSummaries(
  households: Household[],
  meters: Meter[],
  readings: Reading[],
  usage: UsageService,
  from: Date,
  to: Date,
): HouseholdSummary[] {
  const live = new Set(households.map((h) => h.id));
  const grouped = new Map<string, Meter[]>();
  for (const meter of meters) {
    const key =
      meter.householdId && live.has(meter.householdId) ? meter.householdId : UNASSIGNED_ID;
    const group = grouped.get(key);
    if (group) {
      group.push(meter);
    } else {
      grouped.set(key, [meter]);
    }
  }

  const summaries: HouseholdSummary[] = households.map((household) => {
    const own = grouped.get(household.id) ?? [];
    return {
      id: household.id,
      name: household.name,
      role: household.role,
      meters: own,
      rows: usageRows(own, readings, usage, from, to),
    };
  });

  const unassigned = grouped.get(UNASSIGNED_ID) ?? [];
  if (unassigned.length > 0) {
    summaries.push({
      id: UNASSIGNED_ID,
      name: 'Unassigned',
      role: null,
      meters: unassigned,
      rows: usageRows(unassigned, readings, usage, from, to),
    });
  }

  return summaries.sort(
    (a, b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name),
  );
}

function usageRows(
  meters: Meter[],
  readings: Reading[],
  usage: UsageService,
  from: Date,
  to: Date,
): UsageRow[] {
  return UTILITY_TYPES.filter((type) => meters.some((m) => m.type === type)).map((type) => {
    const own = meters
      .filter((m) => m.type === type)
      .map((m) => readings.filter((r) => r.meterId === m.id));
    const total = (selector: typeof CONSUMED) =>
      own.reduce((sum, rs) => sum + usage.totalForRange(rs, from, to, selector), 0);
    const tracksProduction = own.some((rs) => rs.some((r) => r.produced !== null));
    return {
      type,
      label: UTILITY_LABELS[type],
      unit: UTILITY_UNITS[type],
      consumed: total(CONSUMED),
      produced: tracksProduction ? total(PRODUCED) : null,
    };
  });
}
