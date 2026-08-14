import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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
  readonly statusLabel = computed(() => {
    switch (this.status()) {
      case 'syncing':
        return 'Syncing…';
      case 'photos':
        return 'Photos…';
      case 'offline':
        return 'Offline';
      case 'needsAuth':
        return 'Sign in';
      case 'error':
        return 'Sync error';
      case 'idle':
        return 'Synced';
      default:
        return 'Sync off';
    }
  });
  readonly needsAttention = computed(
    () => this.status() === 'needsAuth' || this.status() === 'error',
  );
  readonly lastSyncAt = this.sync.lastSyncAt;
  readonly configured = this.sync.configured;
  private readonly router = inject(Router);

  activate(): void {
    if (this.status() === 'needsAuth') {
      void this.router.navigate(['/settings']);
      return;
    }
    void this.sync.syncNow();
  }
}
