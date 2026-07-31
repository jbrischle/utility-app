import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { LocalStore } from '../../../data/local-store';
import { UsageService, CONSUMED, PRODUCED, ValueFn } from '../../../services/usage';
import { UsageChart, ChartSeries } from '../../../shared/usage-chart/usage-chart';
import { UTILITY_LABELS } from '../../../models/utility-type';
import { ReadingWithUsage } from '../../../models/reading.model';

type Granularity = 'interval' | 'monthly';

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfWeek(d: Date): Date {
  const offset = (d.getDay() + 6) % 7; // Monday-based
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function daysBetween(a: Date, b: Date): number {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

interface Stats {
  thisMonth: number;
  lastMonth: number;
  deltaPct: number | null;
  perDayAvg: number;
  weekTotal: number;
  yearTotal: number;
}

@Component({
  selector: 'app-meter-detail',
  imports: [RouterLink, DatePipe, DecimalPipe, UsageChart],
  templateUrl: './meter-detail.html',
  styleUrl: './meter-detail.css',
})
export class MeterDetail {
  private readonly store = inject(LocalStore);
  private readonly usage = inject(UsageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly labels = UTILITY_LABELS;
  readonly id = this.route.snapshot.paramMap.get('id')!;
  private readonly now = new Date();

  readonly meter = computed(() => this.store.meterById(this.id));
  readonly isElectricity = computed(() => this.meter()?.type === 'electricity');
  readonly notFound = computed(() => this.store.ready() && !this.meter());

  readonly granularity = signal<Granularity>('interval');
  readonly confirmDeleteMeter = signal(false);
  readonly confirmDeleteReading = signal<string | null>(null);
  readonly viewPhotoUrl = signal<string | null>(null);
  readonly photoUrls = signal<Map<string, string>>(new Map());

  private readonly readings = computed(() => this.store.readingsForMeter(this.id));

  /** Readings annotated with usage, newest first for the log table. */
  readonly rows = computed<ReadingWithUsage[]>(() =>
    [...this.usage.withUsage(this.readings())].reverse(),
  );

  readonly hasEnoughData = computed(() => this.readings().length >= 2);

  readonly chartLabels = computed<string[]>(() => {
    if (this.granularity() === 'monthly') {
      return this.usage.monthlyTotals(this.readings()).map((m) => this.formatMonth(m.label));
    }
    const annotated = this.usage.withUsage(this.readings());
    return annotated.slice(1).map((r) =>
      new Date(r.reading.readAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
    );
  });

  private seriesData(selector: ValueFn, key: 'usage' | 'producedUsage'): number[] {
    const readings = this.readings();
    if (this.granularity() === 'monthly') {
      return this.usage
        .monthlyTotals(readings, selector)
        .map((m) => Math.round(m.total * 100) / 100);
    }
    return this.usage
      .withUsage(readings)
      .slice(1)
      .map((r) => Math.round((r[key] ?? 0) * 100) / 100);
  }

  readonly chartSeries = computed<ChartSeries[]>(() => {
    const consumedColor = this.isElectricity()
      ? '#f5b544'
      : this.meter()?.type === 'water'
        ? '#38bdf8'
        : '#4f8cff';
    const series: ChartSeries[] = [
      {
        label: this.isElectricity() ? 'Consumed' : 'Usage',
        data: this.seriesData(CONSUMED, 'usage'),
        color: consumedColor,
      },
    ];
    if (this.isElectricity()) {
      series.push({
        label: 'Produced',
        data: this.seriesData(PRODUCED, 'producedUsage'),
        color: '#4ade80',
      });
    }
    return series;
  });

  private computeStats(selector: ValueFn): Stats {
    const readings = this.readings();
    const monthStart = startOfMonth(this.now);
    const nextMonth = addMonths(monthStart, 1);
    const prevMonth = addMonths(monthStart, -1);
    const weekStart = startOfWeek(this.now);
    const yearStart = new Date(this.now.getFullYear(), 0, 1);
    const tomorrow = addDays(startOfDay(this.now), 1);

    const thisMonth = this.usage.totalForRange(readings, monthStart, nextMonth, selector);
    const lastMonth = this.usage.totalForRange(readings, prevMonth, monthStart, selector);
    const elapsedDays = daysBetween(monthStart, tomorrow);

    return {
      thisMonth,
      lastMonth,
      deltaPct: lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : null,
      perDayAvg: thisMonth / elapsedDays,
      weekTotal: this.usage.totalForRange(readings, weekStart, tomorrow, selector),
      yearTotal: this.usage.totalForRange(readings, yearStart, tomorrow, selector),
    };
  }

  readonly stats = computed<Stats>(() => this.computeStats(CONSUMED));
  readonly producedStats = computed<Stats>(() => this.computeStats(PRODUCED));

  constructor() {
    effect(() => {
      const rows = this.rows();
      untracked(() => {
        const map = new Map(this.photoUrls());
        let changed = false;
        for (const row of rows) {
          const pid = row.reading.photoId;
          if (pid && !map.has(pid)) {
            changed = true;
            map.set(pid, ''); // reserve slot to avoid duplicate loads
            void this.store.getPhoto(pid).then((photo) => {
              if (photo) {
                const next = new Map(this.photoUrls());
                next.set(pid, URL.createObjectURL(photo.data));
                this.photoUrls.set(next);
              }
            });
          }
        }
        if (changed) this.photoUrls.set(map);
      });
    });
  }

  setGranularity(g: Granularity): void {
    this.granularity.set(g);
  }

  photoUrl(photoId: string | null): string | null {
    if (!photoId) return null;
    return this.photoUrls().get(photoId) || null;
  }

  openPhoto(photoId: string | null): void {
    const url = this.photoUrl(photoId);
    if (url) this.viewPhotoUrl.set(url);
  }
  closePhoto(): void {
    this.viewPhotoUrl.set(null);
  }

  formatMonth(label: string): string {
    const [year, month] = label.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric',
    });
  }

  async deleteMeter(): Promise<void> {
    await this.store.deleteMeter(this.id);
    this.confirmDeleteMeter.set(false);
    await this.router.navigate(['/meters']);
  }

  async deleteReading(id: string): Promise<void> {
    await this.store.deleteReading(id);
    this.confirmDeleteReading.set(null);
  }
}
