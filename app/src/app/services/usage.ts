import { Injectable } from '@angular/core';
import { Reading, ReadingWithUsage } from '../models/reading.model';

/**
 * Usage/consumption computations.
 *
 * Meters store cumulative totals, so consumption between two consecutive
 * readings is `value(n) - value(n-1)`. Electricity meters additionally store a
 * cumulative `produced` register (fed-in energy), computed the same way.
 *
 * Attribution method for period totals (documented in the PRD): the consumption
 * of an interval is spread EVENLY across the calendar days it spans (from the
 * earlier reading's day up to, but not including, the later reading's day). A
 * period total is then the sum of the daily amounts whose day falls inside the
 * period. This gives stable month/week/year totals even when readings are taken
 * on irregular dates.
 */

/** Extracts the value to aggregate from a reading. */
export type ValueFn = (r: Reading) => number;

export const CONSUMED: ValueFn = (r) => r.value;
export const PRODUCED: ValueFn = (r) => r.produced ?? 0;

/** Calendar-day ordinal (days since epoch) for a date, ignoring time of day. */
export function calendarDay(iso: string): number {
  const d = new Date(iso);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

@Injectable({ providedIn: 'root' })
export class UsageService {
  /**
   * Sorts readings ascending by readAt and annotates each with the consumption
   * and production since the previous one.
   */
  withUsage(readings: Reading[]): ReadingWithUsage[] {
    const sorted = [...readings].sort((a, b) => a.readAt.localeCompare(b.readAt));
    const result: ReadingWithUsage[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const reading = sorted[i];
      if (i === 0) {
        result.push({
          reading,
          usage: null,
          producedUsage: null,
          perDayAverage: null,
        });
        continue;
      }
      const prev = sorted[i - 1];
      const usage = reading.value - prev.value;
      const producedUsage =
        reading.produced !== null && prev.produced !== null
          ? reading.produced - prev.produced
          : null;
      const spanDays = Math.max(1, calendarDay(reading.readAt) - calendarDay(prev.readAt));
      result.push({
        reading,
        usage,
        producedUsage,
        perDayAverage: usage / spanDays,
      });
    }
    return result;
  }

  /** Total between the first and last reading for the selected value. */
  totalConsumption(readings: Reading[], selector: ValueFn = CONSUMED): number {
    if (readings.length < 2) return 0;
    const sorted = [...readings].sort((a, b) => a.readAt.localeCompare(b.readAt));
    return selector(sorted[sorted.length - 1]) - selector(sorted[0]);
  }

  /**
   * Spreads each interval's usage evenly across the calendar days it spans.
   * Returns a map of calendar-day ordinal -> usage on that day.
   */
  dailyBuckets(readings: Reading[], selector: ValueFn = CONSUMED): Map<number, number> {
    const sorted = [...readings].sort((a, b) => a.readAt.localeCompare(b.readAt));
    const buckets = new Map<number, number>();
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const usage = selector(curr) - selector(prev);
      const startDay = calendarDay(prev.readAt);
      const endDay = calendarDay(curr.readAt);
      const span = endDay - startDay;
      if (span <= 0) {
        buckets.set(startDay, (buckets.get(startDay) ?? 0) + usage);
        continue;
      }
      const perDay = usage / span;
      for (let d = startDay; d < endDay; d++) {
        buckets.set(d, (buckets.get(d) ?? 0) + perDay);
      }
    }
    return buckets;
  }

  /** Total usage attributed to calendar days within [start, end). */
  totalForRange(readings: Reading[], start: Date, end: Date, selector: ValueFn = CONSUMED): number {
    const startDay = Math.floor(
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) / 86_400_000,
    );
    const endDay = Math.floor(
      Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) / 86_400_000,
    );
    const buckets = this.dailyBuckets(readings, selector);
    let total = 0;
    for (const [day, usage] of buckets) {
      if (day >= startDay && day < endDay) {
        total += usage;
      }
    }
    return total;
  }

  /** Aggregates daily-distributed usage into buckets keyed by a period function. */
  private periodTotals(
    readings: Reading[],
    selector: ValueFn,
    keyFn: (date: Date) => string,
  ): { label: string; total: number }[] {
    const sorted = [...readings].sort((a, b) => a.readAt.localeCompare(b.readAt));
    const totals = new Map<string, number>();
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const usage = selector(curr) - selector(prev);
      const startDay = calendarDay(prev.readAt);
      const endDay = calendarDay(curr.readAt);
      const span = Math.max(1, endDay - startDay);
      const perDay = usage / span;
      for (let d = startDay; d < Math.max(endDay, startDay + 1); d++) {
        const key = keyFn(new Date(d * 86_400_000));
        totals.set(key, (totals.get(key) ?? 0) + perDay);
      }
    }
    return [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, total]) => ({ label, total }));
  }

  /** Aggregates usage into monthly totals, returned sorted ascending. */
  monthlyTotals(
    readings: Reading[],
    selector: ValueFn = CONSUMED,
  ): { label: string; total: number }[] {
    return this.periodTotals(
      readings,
      selector,
      (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    );
  }

  /** Aggregates usage into yearly totals, returned sorted ascending. */
  yearlyTotals(
    readings: Reading[],
    selector: ValueFn = CONSUMED,
  ): { label: string; total: number }[] {
    return this.periodTotals(readings, selector, (d) => `${d.getUTCFullYear()}`);
  }
}
