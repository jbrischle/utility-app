import { beforeEach, describe, expect, it } from 'vitest';
import { buildHouseholdSummaries, rollingYear, UNASSIGNED_ID } from './household-summary';
import { UsageService } from '../../services/usage';
import { Household, HouseholdRole } from '../../models/household.model';
import { Meter } from '../../models/meter.model';
import { Reading } from '../../models/reading.model';
import { UtilityType } from '../../models/utility-type';

function household(id: string, name: string, role: HouseholdRole = 'unit'): Household {
  return {
    id,
    name,
    role,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
  };
}

function meter(id: string, householdId: string | null, type: UtilityType = 'electricity'): Meter {
  return {
    id,
    name: id,
    type,
    unit: type === 'electricity' ? 'kWh' : 'm³',
    location: '',
    serialNumber: '',
    notes: '',
    householdId,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
  };
}

function reading(
  meterId: string,
  consumed: number,
  readAt: string,
  produced: number | null = null,
): Reading {
  return {
    id: `${meterId}-${readAt}`,
    meterId,
    consumed,
    produced,
    readAt,
    note: '',
    photoId: null,
    createdAt: readAt,
    updatedAt: readAt,
    deletedAt: null,
  };
}

describe('rollingYear', () => {
  it('spans from the same date one year ago up to today', () => {
    const { from, to } = rollingYear(new Date(2026, 7, 13));
    expect(from).toEqual(new Date(2025, 7, 13));
    expect(to).toEqual(new Date(2026, 7, 13));
  });
});

describe('buildHouseholdSummaries', () => {
  let usage: UsageService;
  const from = new Date(2025, 7, 13);
  const to = new Date(2026, 7, 13);

  beforeEach(() => {
    usage = new UsageService();
  });

  it('totals each utility type separately within the window', () => {
    const meters = [meter('e1', 'h1'), meter('w1', 'h1', 'water')];
    const readings = [
      // 1 kWh/day across the whole window and 20 days beyond its start.
      reading('e1', 0, '2025-07-24T00:00:00Z'),
      reading('e1', 385, '2026-08-13T00:00:00Z'),
      reading('w1', 0, '2025-08-13T00:00:00Z'),
      reading('w1', 50, '2026-08-13T00:00:00Z'),
    ];
    const [summary] = buildHouseholdSummaries(
      [household('h1', 'Second floor')],
      meters,
      readings,
      usage,
      from,
      to,
    );
    expect(summary.rows).toHaveLength(2);
    const electricity = summary.rows.find((r) => r.type === 'electricity');
    const water = summary.rows.find((r) => r.type === 'water');
    // Only the 365 days inside the window count, not the 20 days before it.
    expect(electricity?.consumed).toBeCloseTo(365);
    expect(electricity?.unit).toBe('kWh');
    expect(water?.consumed).toBeCloseTo(50);
  });

  it('sums all meters of the same type in a household', () => {
    const readings = [
      reading('e1', 0, '2025-08-13T00:00:00Z'),
      reading('e1', 100, '2026-08-13T00:00:00Z'),
      reading('e2', 0, '2025-08-13T00:00:00Z'),
      reading('e2', 40, '2026-08-13T00:00:00Z'),
    ];
    const [summary] = buildHouseholdSummaries(
      [household('h1', 'Second floor')],
      [meter('e1', 'h1'), meter('e2', 'h1')],
      readings,
      usage,
      from,
      to,
    );
    expect(summary.rows[0].consumed).toBeCloseTo(140);
  });

  it('omits the produced total when no reading records production', () => {
    const readings = [
      reading('e1', 0, '2025-08-13T00:00:00Z'),
      reading('e1', 100, '2026-08-13T00:00:00Z'),
    ];
    const [summary] = buildHouseholdSummaries(
      [household('h1', 'Second floor')],
      [meter('e1', 'h1')],
      readings,
      usage,
      from,
      to,
    );
    expect(summary.rows[0].produced).toBeNull();
  });

  it('reports the produced total as soon as production is recorded', () => {
    const readings = [
      reading('e1', 0, '2025-08-13T00:00:00Z', 0),
      reading('e1', 100, '2026-08-13T00:00:00Z', 30),
    ];
    const [summary] = buildHouseholdSummaries(
      [household('h1', 'Second floor')],
      [meter('e1', 'h1')],
      readings,
      usage,
      from,
      to,
    );
    expect(summary.rows[0].produced).toBeCloseTo(30);
  });

  it('orders units alphabetically, then building totals, then unassigned', () => {
    const households = [
      household('hb', 'House', 'building'),
      household('h3', '3rd floor'),
      household('h2', '2nd floor'),
    ];
    const meters = [meter('m1', 'h3'), meter('m2', 'h2'), meter('m3', 'hb'), meter('m4', null)];
    const summaries = buildHouseholdSummaries(households, meters, [], usage, from, to);
    expect(summaries.map((s) => s.name)).toEqual(['2nd floor', '3rd floor', 'House', 'Unassigned']);
  });

  it('collects meters whose household no longer exists as unassigned', () => {
    const meters = [meter('m1', 'h1'), meter('m2', 'gone'), meter('m3', null)];
    const summaries = buildHouseholdSummaries(
      [household('h1', 'Second floor')],
      meters,
      [],
      usage,
      from,
      to,
    );
    const unassigned = summaries.find((s) => s.id === UNASSIGNED_ID);
    expect(unassigned?.meters.map((m) => m.id)).toEqual(['m2', 'm3']);
    expect(unassigned?.role).toBeNull();
  });

  it('omits the unassigned bucket when every meter is assigned', () => {
    const summaries = buildHouseholdSummaries(
      [household('h1', 'Second floor')],
      [meter('m1', 'h1')],
      [],
      usage,
      from,
      to,
    );
    expect(summaries.some((s) => s.id === UNASSIGNED_ID)).toBe(false);
  });

  it('keeps a household without meters visible but without usage rows', () => {
    const summaries = buildHouseholdSummaries([household('h1', 'Empty')], [], [], usage, from, to);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].rows).toEqual([]);
  });
});
