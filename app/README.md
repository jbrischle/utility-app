# Meter Tracker (Offline PWA + optional sync)

An offline-first Angular PWA for tracking home utility meter readings (electricity and water). All data is stored locally in the browser (IndexedDB); no server or account is required. An optional self-hosted [PocketBase](https://pocketbase.io) backend (see [`../pocketbase`](../pocketbase)) adds multi-device sync and backup.

## Features

- Manage multiple meters (electricity / water) with name, location, serial number and notes.
- Record **cumulative** meter readings; consumption between readings is computed automatically.
- Electricity meters track **two registers**: consumed (drawn from grid) and produced (fed in).
- Warning when a new reading is lower than the previous one (likely typo).
- Edit and (soft) delete meters and readings.
- Optional photo per reading (captured/compressed and stored offline).
- Group meters into **households** (managed under **Settings**); the dashboard shows one card
  per household with rolling 12-month totals per utility type.
- Per-meter usage charts with selectable granularity (by reading interval, monthly, or yearly).
- Comparisons (this month vs last, per-day average) and summary totals (week / month / year).
- Installable PWA that works fully offline.
- **Optional multi-device sync** to a self-hosted PocketBase (configure under **Settings**).

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

The production bundle is emitted to `dist/meter-tracker`. Serve that folder with any static file server to test offline/PWA behaviour, e.g.:

```bash
npx http-server dist/meter-tracker
```

## Test

```bash
npm test
```

Unit tests (Vitest) cover the usage/period computations in
`src/app/services/usage.ts`, the dashboard's household aggregation in
`src/app/features/dashboard/household-summary.ts`, and the sync engine's merge,
cursor and photo-queue behaviour in `src/app/services/sync.spec.ts` — the last
of these runs against a fake gateway, so no PocketBase is needed.

Wire-level behaviour is verified by hand instead; see the checklist under
[Sync](#sync-optional). The split is deliberate: merge bugs fail _silently_ and
are pure logic, so they are worth automating, whereas a wrong filter format or a
botched upload fails loudly the first time it runs.

## Architecture notes

- **`src/app/data/local-store.ts`** is the single data-access layer. It is the only module that touches IndexedDB, exposing signals (`meters`, `readings`) that the UI reacts to.
- **`src/app/services/pocketbase-gateway.ts`** is the mirror rule for the network: it is the only module that touches the PocketBase client. Everything above it works against that interface, which is what keeps the SDK's global state (base URL, auth store, auto-cancellation) owned by one file and lets the sync logic be tested without a server.
- **`src/app/services/usage.ts`** holds all consumption math.
- Every record carries `createdAt` / `updatedAt` / `deletedAt`; deletes are **soft**
  (records are hidden, not removed) so a future sync engine can propagate deletions.

### Usage attribution method

Meters store cumulative totals, so the consumption of an interval is
`value(n) - value(n-1)`. For period totals (week / month / year) each interval's consumption is spread **evenly across the calendar days it spans** (from the earlier reading's day up to, but not including, the later reading's day). A period total is the sum of the daily amounts whose day falls inside the period. This keeps month/week/year totals stable even when readings are taken on irregular dates.

## Sync (optional)

Sync is off by default and the app never gates on it: with no server configured, or while
signed out, everything works exactly as it does offline. To enable it:

1. Run PocketBase (see [`../pocketbase`](../pocketbase)) and create an account for yourself
   in the Dashboard under `utility_users`. There is no self-signup by design.
2. In the app, open **Settings**, set the **Server URL**, **Save**, then sign in.

A status chip in the header shows the state. Two of its states are ordinary and stay
muted — _sync off_ and _offline_ — because an app built to work in a basement should not
report the basement as a fault. Two draw attention because you can act on them: _sign in_
(the session ended on its own) and _sync error_.

### How it works

- **`src/app/services/sync.ts`** holds the cursor, merge rules and scheduling;
  `pocketbase-gateway.ts` does the talking. The UI never waits on either.
- **Every cycle pulls before it pushes.** This is a correctness invariant, not an
  incidental ordering: conflicts are resolved on the client, so pushing first would let a
  device overwrite an edit it has not seen.
- **Conflicts** are last-write-wins on `updatedAt` — the clock of the device that made the
  edit, which is what "who edited later" means. The **pull cursor** uses PocketBase's own
  `updated` instead, because "what has the server seen" is a question about the server's
  clock; a device whose clock ran fast would otherwise skip records permanently.
- **Pulls are keyset-paginated** (`updated,id`) and the cursor advances per page, so an
  interrupted sync resumes instead of restarting.
- **Pushes create first** and fall back to update on `validation_pk_invalid`. That fallback
  is normal traffic, not an error: most writes here are new readings.
- **Photos** ride the reading's file field, uploaded and downloaded in a pass _after_ the
  records so the app stays usable during a large backfill. They are downloaded eagerly —
  a photo you can only see when you have signal defeats the point.
- Soft deletes propagate as ordinary edits and destroy nothing, on either side.

### Changing servers

The token and cursor are deliberately **not** keyed by URL, because one PocketBase is
often reachable at more than one address and re-pulling everything on each network change
would be worse. Pointing the app at a genuinely different backend therefore needs
**Full resync**, or it inherits a cursor that server never reached and silently skips
older records.

### Manual smoke checklist

Run after changing anything in `sync.ts`, `pocketbase-gateway.ts` or `sync-mapping.ts`:

1. Sign in; confirm the chip reaches _Synced_.
2. Add a reading **with a photo**; confirm both the record and the image appear in the
   PocketBase Dashboard.
3. Load the app in a second browser profile, sign in, and confirm the reading **and its
   photo** arrive.
4. Go offline in both, edit the same reading in each, then reconnect. The **later** edit
   must win in both places.
5. Soft-delete a reading; confirm it disappears in both and that `deletedAt` is set —
   rather than the record being gone — in the Dashboard.
6. Sign out; confirm local data is untouched and the chip goes muted rather than red.

## Data & privacy

All data lives in your browser's IndexedDB on this device. Clearing site data or
uninstalling removes it — the app requests persistent storage after your first save to
make eviction unlikely. If you enable sync, data is also stored on **your own** PocketBase;
no third parties are involved.
