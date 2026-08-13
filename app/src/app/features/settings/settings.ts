import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SyncService } from '../../services/sync';
import { LocalStore } from '../../data/local-store';
import {
  Household,
  HOUSEHOLD_ROLE_LABELS,
  HOUSEHOLD_ROLES,
  HouseholdRole,
} from '../../models/household.model';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, DatePipe],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings {
  readonly roles = HOUSEHOLD_ROLES;
  readonly roleLabels = HOUSEHOLD_ROLE_LABELS;
  private readonly sync = inject(SyncService);
  private readonly store = inject(LocalStore);

  readonly status = this.sync.status;
  readonly lastSyncAt = this.sync.lastSyncAt;
  readonly lastError = this.sync.lastError;
  readonly enabled = this.sync.enabled;

  readonly serverUrl = signal<string>(this.sync.serverUrl());
  readonly saving = signal(false);
  readonly resyncing = signal(false);

  readonly households = this.store.households;
  readonly newName = signal('');
  readonly newRole = signal<HouseholdRole>('unit');
  readonly editingId = signal<string | null>(null);
  readonly editName = signal('');
  readonly editRole = signal<HouseholdRole>('unit');
  readonly confirmDeleteId = signal<string | null>(null);

  readonly meterCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const meter of this.store.meters()) {
      if (meter.householdId) {
        counts.set(meter.householdId, (counts.get(meter.householdId) ?? 0) + 1);
      }
    }
    return counts;
  });

  readonly pendingDelete = computed(
    () => this.households().find((h) => h.id === this.confirmDeleteId()) ?? null,
  );

  readonly statusLabel = computed(() => {
    switch (this.status()) {
      case 'syncing':
        return 'Syncing…';
      case 'offline':
        return 'Offline';
      case 'error':
        return 'Error';
      case 'idle':
        return 'Connected';
      default:
        return 'Disabled';
    }
  });

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      await this.sync.setServerUrl(this.serverUrl());
    } finally {
      this.saving.set(false);
    }
  }

  async disable(): Promise<void> {
    this.serverUrl.set('');
    await this.save();
  }

  syncNow(): void {
    void this.sync.syncNow();
  }

  async fullResync(): Promise<void> {
    this.resyncing.set(true);
    try {
      await this.sync.fullResync();
    } finally {
      this.resyncing.set(false);
    }
  }

  async addHousehold(): Promise<void> {
    const name = this.newName().trim();
    if (!name) return;
    await this.store.addHousehold({ name, role: this.newRole() });
    this.newName.set('');
    this.newRole.set('unit');
  }

  startEdit(household: Household): void {
    this.editingId.set(household.id);
    this.editName.set(household.name);
    this.editRole.set(household.role);
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  async saveEdit(): Promise<void> {
    const id = this.editingId();
    const name = this.editName().trim();
    if (!id || !name) return;
    await this.store.updateHousehold(id, { name, role: this.editRole() });
    this.editingId.set(null);
  }

  async deleteHousehold(id: string): Promise<void> {
    await this.store.deleteHousehold(id);
    this.confirmDeleteId.set(null);
  }
}
