import { Injectable } from '@angular/core';
import { Reading, ReadingWithUsage } from '../models/reading.model';

/**
 * Usage/consumption computations.
 *
 * Meters store cumulative totals, so consumption between two consecutive
 * readings is `value(n) - value(n-1)`.
 *
 * Attribution method for period totals (documented in the PRD): the consumption
 * of an interval is spread EVENLY across the calendar days it spans (from the
 * earlier reading's day up to, but not including, the later reading's day). A
 * period total is then the sum of the daily amounts whose day falls inside the
 * period. This gives stable month/week/year totals even when readings are taken
 * on irregular dates.
 */

/** Calendar-day ordinal (days since epoch) for a date, ignoring time of day. */
export function calendarDay(iso: string): number {
  const d = new Date(iso);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

export interface DailyUsage {
  /** Calendar-day ordinal. */
  day: number;
  usage: number;
}

@Injectable({ providedIn: 'root' })
export class UsageService {
  /** Sorts readings ascending by readAt and annotates each with usage vs the previous one. */
  withUsage(readings: Reading[]): ReadingWithUsage[] {
    const sorted = [...readings].sort((a, b) => a.readAt.localeCompare(b.readAt));
    const result: ReadingWithUsage[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const reading = sorted[i];
      if (i === 0) {
        result.push({ reading, usage: null, perDayAverage: null });
        continue;
      }
      const prev = sorted[i - 1];
      const usage = reading.value - prev.value;
      const spanDays = Math.max(1, calendarDay(reading.readAt) - calendarDay(prev.readAt));
      result.push({ reading, usage, perDayAverage: usage / spanDays });
    }
    return result;
  }

  /** Total consumption between the first and last reading (ignores time distribution). */
  totalConsumption(readings: Reading[]): number {
    if (readings.length < 2) return 0;
    const sorted = [...readings].sort((a, b) => a.readAt.localeCompare(b.readAt));
    return sorted[sorted.length - 1].value - sorted[0].value;
  }

  /**
   * Spreads each interval's consumption evenly across the calendar days it spans.
   * Returns a map of calendar-day ordinal -> usage on that day.
   */
  dailyBuckets(readings: Reading[]): Map<number, number> {
    const sorted = [...readings].sort((a, b) => a.readAt.localeCompare(b.readAt));
    const buckets = new Map<number, number>();
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const usage = curr.value - prev.value;
      const startDay = calendarDay(prev.readAt);
      const endDay = calendarDay(curr.readAt);
      const span = endDay - startDay;
      if (span <= 0) {
        // Same-day reading: attribute all usage to that day.
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

  /** Total consumption attributed to calendar days within [start, end). */
  totalForRange(readings: Reading[], start: Date, end: Date): number {
    const startDay = Math.floor(
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) / 86_400_000,
    );
    const endDay = Math.floor(
      Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) / 86_400_000,
    );
    const buckets = this.dailyBuckets(readings);
    let total = 0;
    for (const [day, usage] of buckets) {
      if (day >= startDay && day < endDay) {
        total += usage;
      }
    }
    return total;
  }

  /** Aggregates daily buckets into monthly totals, returned sorted ascending. */
  monthlyTotals(readings: Reading[]): { label: string; total: number }[] {
    const sorted = [...readings].sort((a, b) => a.readAt.localeCompare(b.readAt));
    const monthly = new Map<string, number>();
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const usage = curr.value - prev.value;
      const startDay = calendarDay(prev.readAt);
      const endDay = calendarDay(curr.readAt);
      const span = Math.max(1, endDay - startDay);
      const perDay = usage / span;
      for (let d = startDay; d < Math.max(endDay, startDay + 1); d++) {
        const date = new Date(d * 86_400_000);
        const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
        monthly.set(key, (monthly.get(key) ?? 0) + perDay);
      }
    }
    return [...monthly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, total]) => ({ label, total }));
  }
}
