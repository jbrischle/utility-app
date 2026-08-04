import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { SyncService } from './services/sync';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly sync = inject(SyncService);

  readonly status = this.sync.status;
  readonly lastSyncAt = this.sync.lastSyncAt;
  readonly enabled = this.sync.enabled;

  readonly statusLabel = computed(() => {
    switch (this.status()) {
      case 'syncing':
        return 'Syncing…';
      case 'offline':
        return 'Offline';
      case 'error':
        return 'Sync error';
      case 'idle':
        return 'Synced';
      default:
        return 'Sync off';
    }
  });

  syncNow(): void {
    void this.sync.syncNow();
  }
}
