# Meter Tracker (Offline PWA + optional sync)

An offline-first Angular PWA for tracking home utility meter readings (electricity and water). All data is stored locally in the browser (IndexedDB); no server or account is required. An optional self-hosted server (see [`../server`](../server)) adds multi-device sync and backup. See `../docs/prd/` for the full product requirements.

## Features

- Manage multiple meters (electricity / water) with name, location, serial number and notes.
- Record **cumulative** meter readings; consumption between readings is computed automatically.
- Electricity meters track **two registers**: consumed (drawn from grid) and produced (fed in).
- Warning when a new reading is lower than the previous one (likely typo).
- Edit and (soft) delete meters and readings.
- Optional photo per reading (captured/compressed and stored offline).
- Dashboard with per-meter cards and monthly totals per utility type.
- Per-meter usage charts with selectable granularity (by reading interval, monthly, or yearly).
- Comparisons (this month vs last, per-day average) and summary totals (week / month / year).
- Installable PWA that works fully offline.
- **Optional multi-device sync** to a self-hosted server (configure under **Settings**).

## Tech stack

- Angular 22 (standalone components, signals, lazy-loaded routes)
- IndexedDB via [Dexie](https://dexie.org/)
- Charts via [Chart.js](https://www.chartjs.org/)
- `@angular/service-worker` for offline + installability

## Getting started

```bash
npm install
npm start
```

Then open the printed local URL (default http://localhost:4200).

> Note: the service worker is only enabled in production builds, so offline mode
> and installability are testable after building and serving the production output.

## Build

```bash
npm run build
```

The production bundle is emitted to `dist/meter-tracker/browser`. Serve that folder with any static file server to test offline/PWA behaviour, e.g.:

```bash
npx http-server dist/meter-tracker/browser
```

## Test

```bash
npm test
```

Unit tests (Vitest) cover the usage/period computations in
`src/app/services/usage.ts`.

## Architecture notes

- **`src/app/data/local-store.ts`** is the single data-access layer. It is the only module that touches IndexedDB, exposing signals (`meters`, `readings`) that the UI reacts to. Phase 2 (server sync) will layer on top of this without changing the UI.
- **`src/app/services/usage.ts`** holds all consumption math.
- Every record carries `createdAt` / `updatedAt` / `deletedAt`; deletes are **soft**
  (records are hidden, not removed) so a future sync engine can propagate deletions.

### Usage attribution method

Meters store cumulative totals, so the consumption of an interval is
`value(n) - value(n-1)`. For period totals (week / month / year) each interval's consumption is spread **evenly across the calendar days it spans** (from the earlier reading's day up to, but not including, the later reading's day). A period total is the sum of the daily amounts whose day falls inside the period. This keeps month/week/year totals stable even when readings are taken on irregular dates.

## Sync (optional)

Sync is off by default; the app is fully usable offline without any server. To enable it:

1. Run the sync server (see [`../server/README.md`](../server/README.md)).
2. In the app, go to **Settings** and set the **Server URL** to your server's LAN address
   (e.g. `http://192.168.1.50:3000`), then **Save & sync**.

Once configured, a status chip in the header shows the sync state (synced / syncing /
offline / error) and lets you trigger **Sync now**. The app also syncs automatically on
startup, when it comes back online, and periodically while online.

- **`src/app/services/sync.ts`** is the sync engine. It depends only on `LocalStore` and
  `fetch`, so Phase 1 data flows are unchanged — components keep reading/writing locally
  and sync happens in the background.
- **Conflict resolution** is last-write-wins by `updatedAt`; soft deletes propagate like
  edits. Photos (immutable blobs) transfer in whichever direction a peer is missing them.
- A per-server `lastSyncAt` cursor is stored in IndexedDB; the configured server URL is in
  `localStorage`. Clearing the URL disables sync and the app behaves exactly as Phase 1.

## Data & privacy

All data lives in your browser's IndexedDB on this device. Clearing site data or
uninstalling removes it. If you enable sync, data is also stored on **your own** server
(private network only, no third parties) — see the security note in
[`../server/README.md`](../server/README.md).
