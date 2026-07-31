import { describe, it, expect, beforeEach } from 'vitest';
import { UsageService, calendarDay, PRODUCED } from './usage';
import { Reading } from '../models/reading.model';

function reading(
  id: string,
  value: number,
  readAt: string,
  produced: number | null = null,
): Reading {
  return {
    id,
    meterId: 'm1',
    value,
    produced,
    readAt,
    note: '',
    photoId: null,
    createdAt: readAt,
    updatedAt: readAt,
    deletedAt: null,
  };
}

describe('UsageService', () => {
  let svc: UsageService;

  beforeEach(() => {
    svc = new UsageService();
  });

  it('leaves the first reading without usage and computes deltas for the rest', () => {
    const readings = [
      reading('a', 100, '2026-01-01T08:00:00Z'),
      reading('b', 130, '2026-01-31T08:00:00Z'),
      reading('c', 160, '2026-03-02T08:00:00Z'),
    ];
    const result = svc.withUsage(readings);
    expect(result[0].usage).toBeNull();
    expect(result[1].usage).toBe(30);
    expect(result[2].usage).toBe(30);
  });

  it('computes a per-day average across the interval span', () => {
    const readings = [
      reading('a', 0, '2026-01-01T00:00:00Z'),
      reading('b', 100, '2026-01-11T00:00:00Z'), // 10 day span
    ];
    const result = svc.withUsage(readings);
    expect(result[1].perDayAverage).toBe(10);
  });

  it('totalConsumption is last minus first', () => {
    const readings = [
      reading('a', 50, '2026-01-01T00:00:00Z'),
      reading('b', 75, '2026-02-01T00:00:00Z'),
      reading('c', 200, '2026-03-01T00:00:00Z'),
    ];
    expect(svc.totalConsumption(readings)).toBe(150);
  });

  it('returns 0 total consumption for fewer than two readings', () => {
    expect(svc.totalConsumption([])).toBe(0);
    expect(svc.totalConsumption([reading('a', 10, '2026-01-01T00:00:00Z')])).toBe(0);
  });

  it('spreads interval usage evenly across the days it spans', () => {
    const readings = [
      reading('a', 0, '2026-01-01T00:00:00Z'),
      reading('b', 10, '2026-01-06T00:00:00Z'), // 5 day span -> 2/day on days 1..5
    ];
    const buckets = svc.dailyBuckets(readings);
    const d1 = calendarDay('2026-01-01T00:00:00Z');
    const d5 = calendarDay('2026-01-05T00:00:00Z');
    const d6 = calendarDay('2026-01-06T00:00:00Z');
    expect(buckets.get(d1)).toBeCloseTo(2);
    expect(buckets.get(d5)).toBeCloseTo(2);
    // The later reading's own day gets nothing from this interval.
    expect(buckets.get(d6)).toBeUndefined();
    const sum = [...buckets.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(10);
  });

  it('totalForRange sums only days within the range', () => {
    const readings = [
      reading('a', 0, '2026-01-01T00:00:00Z'),
      reading('b', 31, '2026-02-01T00:00:00Z'), // 1/day across January (31 days)
    ];
    // Whole of January.
    const janTotal = svc.totalForRange(readings, new Date(2026, 0, 1), new Date(2026, 1, 1));
    expect(janTotal).toBeCloseTo(31);
    // First 10 days of January -> 10 units.
    const firstTen = svc.totalForRange(readings, new Date(2026, 0, 1), new Date(2026, 0, 11));
    expect(firstTen).toBeCloseTo(10);
  });

  it('computes produced usage separately with the PRODUCED selector', () => {
    const readings = [
      reading('a', 100, '2026-01-01T00:00:00Z', 20),
      reading('b', 130, '2026-02-01T00:00:00Z', 50),
    ];
    const result = svc.withUsage(readings);
    expect(result[1].usage).toBe(30);
    expect(result[1].producedUsage).toBe(30);
    expect(svc.totalConsumption(readings, PRODUCED)).toBe(30);
  });

  it('leaves producedUsage null when production is not tracked', () => {
    const readings = [
      reading('a', 100, '2026-01-01T00:00:00Z'),
      reading('b', 130, '2026-02-01T00:00:00Z'),
    ];
    expect(svc.withUsage(readings)[1].producedUsage).toBeNull();
  });

  it('aggregates monthly totals', () => {
    const readings = [
      reading('a', 0, '2026-01-01T00:00:00Z'),
      reading('b', 31, '2026-02-01T00:00:00Z'),
      reading('c', 59, '2026-03-01T00:00:00Z'),
    ];
    const monthly = svc.monthlyTotals(readings);
    const jan = monthly.find((m) => m.label === '2026-01');
    const feb = monthly.find((m) => m.label === '2026-02');
    expect(jan?.total).toBeCloseTo(31);
    expect(feb?.total).toBeCloseTo(28);
  });

  it('aggregates yearly totals', () => {
    const readings = [
      reading('a', 0, '2025-01-01T00:00:00Z'),
      reading('b', 100, '2026-01-01T00:00:00Z'),
      reading('c', 250, '2027-01-01T00:00:00Z'),
    ];
    const yearly = svc.yearlyTotals(readings);
    const y2025 = yearly.find((y) => y.label === '2025');
    const y2026 = yearly.find((y) => y.label === '2026');
    expect(y2025?.total).toBeCloseTo(100);
    expect(y2026?.total).toBeCloseTo(150);
  });
});
