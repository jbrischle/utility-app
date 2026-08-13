import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { LocalStore } from '../../data/local-store';
import { UsageService } from '../../services/usage';
import { UTILITY_LABELS } from '../../models/utility-type';
import { Meter } from '../../models/meter.model';
import {
  buildHouseholdSummaries,
  HouseholdSummary,
  rollingYear,
  UNASSIGNED_ID,
} from './household-summary';

interface MeterCard {
  meter: Meter;
  latestValue: number | null;
  latestAt: string | null;
  latestUsage: number | null;
}

interface HouseholdGroup extends HouseholdSummary {
  cards: MeterCard[];
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DatePipe, DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  readonly labels = UTILITY_LABELS;
  readonly unassignedId = UNASSIGNED_ID;
  private readonly expandedIds = signal<ReadonlySet<string>>(new Set());
  private readonly store = inject(LocalStore);
  readonly ready = this.store.ready;
  private readonly usage = inject(UsageService);
  private readonly window = rollingYear(new Date());
  readonly hasMeters = computed(() => this.store.meters().length > 0);
  private readonly cards = computed<MeterCard[]>(() => {
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
  readonly groups = computed<HouseholdGroup[]>(() => {
    const byMeterId = new Map(this.cards().map((card) => [card.meter.id, card]));
    const summaries = buildHouseholdSummaries(
      this.store.households(),
      this.store.meters(),
      this.store.readings(),
      this.usage,
      this.window.from,
      this.window.to,
    );
    return summaries.map((summary) => ({
      ...summary,
      cards: summary.meters
        .map((meter) => byMeterId.get(meter.id))
        .filter((card): card is MeterCard => !!card),
    }));
  });

  isExpanded(householdId: string): boolean {
    return this.expandedIds().has(householdId);
  }

  toggle(householdId: string): void {
    const next = new Set(this.expandedIds());
    if (!next.delete(householdId)) {
      next.add(householdId);
    }
    this.expandedIds.set(next);
  }
}
