import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { LocalStore } from '../../data/local-store';
import { CONSUMED, PRODUCED, UsageService } from '../../services/usage';
import { UTILITY_LABELS, UTILITY_UNITS, UtilityType } from '../../models/utility-type';
import { Meter } from '../../models/meter.model';

interface MeterCard {
  meter: Meter;
  latestValue: number | null;
  latestAt: string | null;
  latestUsage: number | null;
}

interface TypeSummary {
  type: UtilityType;
  label: string;
  unit: string;
  monthTotal: number;
  producedMonthTotal: number | null;
  meterCount: number;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfNextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DatePipe, DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  readonly labels = UTILITY_LABELS;
  private readonly store = inject(LocalStore);
  readonly ready = this.store.ready;
  private readonly usage = inject(UsageService);
  readonly cards = computed<MeterCard[]>(() => {
    const readings = this.store.readings();
    return this.store.meters().map((meter) => {
      const own = readings.filter((r) => r.meterId === meter.id);
      const last = this.usage.withUsage(own).at(-1);
      return {
        meter,
        latestValue: last?.reading.consumed ?? null,
        latestAt: last?.reading.readAt ?? null,
        latestUsage: last?.usage ?? null,
      };
    });
  });
  private readonly now = new Date();
  readonly summaries = computed<TypeSummary[]>(() => {
    const meters = this.store.meters();
    const readings = this.store.readings();
    const monthStart = startOfMonth(this.now);
    const nextMonth = startOfNextMonth(this.now);
    const types = [...new Set(meters.map((m) => m.type))];
    return types.map((type) => {
      const typeMeters = meters.filter((m) => m.type === type);
      const monthTotal = typeMeters.reduce((sum, m) => {
        const own = readings.filter((r) => r.meterId === m.id);
        return sum + this.usage.totalForRange(own, monthStart, nextMonth, CONSUMED);
      }, 0);
      const producedMonthTotal =
        type === 'electricity'
          ? typeMeters.reduce((sum, m) => {
              const own = readings.filter((r) => r.meterId === m.id);
              return sum + this.usage.totalForRange(own, monthStart, nextMonth, PRODUCED);
            }, 0)
          : null;
      return {
        type,
        label: UTILITY_LABELS[type],
        unit: UTILITY_UNITS[type],
        monthTotal,
        producedMonthTotal,
        meterCount: typeMeters.length,
      };
    });
  });
}
