# Meter Tracker (Phase 1 - Offline PWA)

An offline-first Angular PWA for tracking home utility meter readings (electricity
and water). All data is stored locally in the browser (IndexedDB); no server or
account is required. See `../docs/prd/` for the full product requirements.

## Features

- Manage multiple meters (electricity / water) with name, location, serial number and notes.
- Record **cumulative** meter readings; consumption between readings is computed automatically.
- Warning when a new reading is lower than the previous one (likely typo).
- Edit and (soft) delete meters and readings.
- Optional photo per reading (captured/compressed and stored offline).
- Dashboard with per-meter cards and monthly totals per utility type.
- Per-meter usage charts (by reading interval or monthly).
- Comparisons (this month vs last, per-day average) and summary totals (week / month / year).
- Installable PWA that works fully offline.

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

The production bundle is emitted to `dist/meter-tracker/browser`. Serve that folder
with any static file server to test offline/PWA behaviour, e.g.:

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

- **`src/app/data/local-store.ts`** is the single data-access layer. It is the only
  module that touches IndexedDB, exposing signals (`meters`, `readings`) that the UI
  reacts to. Phase 2 (server sync) will layer on top of this without changing the UI.
- **`src/app/services/usage.ts`** holds all consumption math.
- Every record carries `createdAt` / `updatedAt` / `deletedAt`; deletes are **soft**
  (records are hidden, not removed) so a future sync engine can propagate deletions.

### Usage attribution method

Meters store cumulative totals, so the consumption of an interval is
`value(n) - value(n-1)`. For period totals (week / month / year) each interval's
consumption is spread **evenly across the calendar days it spans** (from the earlier
reading's day up to, but not including, the later reading's day). A period total is the
sum of the daily amounts whose day falls inside the period. This keeps month/week/year
totals stable even when readings are taken on irregular dates.

## Data & privacy

All data lives in your browser's IndexedDB on this device only. Clearing site data or
uninstalling removes it. Multi-device sync and backup are planned for Phase 2 (see
`../docs/prd/02-phase-2-sync-and-server.md`).
