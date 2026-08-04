import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SyncService } from '../../services/sync';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, DatePipe],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings {
  private readonly sync = inject(SyncService);

  readonly status = this.sync.status;
  readonly lastSyncAt = this.sync.lastSyncAt;
  readonly lastError = this.sync.lastError;
  readonly enabled = this.sync.enabled;

  readonly serverUrl = signal<string>(this.sync.serverUrl());
  readonly saving = signal(false);

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
}
