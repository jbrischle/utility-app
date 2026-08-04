import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { LocalStore } from '../../../data/local-store';
import { UsageService } from '../../../services/usage';
import { UTILITY_LABELS } from '../../../models/utility-type';
import { Meter } from '../../../models/meter.model';

interface MeterCard {
  meter: Meter;
  latestValue: number | null;
  latestAt: string | null;
  latestUsage: number | null;
  readingCount: number;
}

@Component({
  selector: 'app-meter-list',
  imports: [RouterLink, DatePipe, DecimalPipe],
  templateUrl: './meter-list.html',
  styleUrl: './meter-list.css',
})
export class MeterList {
  private readonly store = inject(LocalStore);
  private readonly usage = inject(UsageService);

  readonly labels = UTILITY_LABELS;
  readonly ready = this.store.ready;

  readonly cards = computed<MeterCard[]>(() => {
    const readings = this.store.readings();
    return this.store.meters().map((meter) => {
      const own = readings.filter((r) => r.meterId === meter.id);
      const withUsage = this.usage.withUsage(own);
      const last = withUsage.at(-1);
      return {
        meter,
        latestValue: last?.reading.value ?? null,
        latestAt: last?.reading.readAt ?? null,
        latestUsage: last?.usage ?? null,
        readingCount: own.length,
      };
    });
  });
}
