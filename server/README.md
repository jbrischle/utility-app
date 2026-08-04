# Meter Tracker Sync Server (Phase 2)

A tiny self-hosted sync + backup server for the [Meter Tracker PWA](../app). It stores
meters, readings and photos in a single SQLite file and reconciles changes from one or
more devices using **last-write-wins** by `updatedAt`.

- **Node.js + Express + TypeScript**, storage via Node's built-in `node:sqlite` (no
  native build step). The `.ts` sources run directly on Node 24+ via native type
  stripping — no separate compile step is needed.
- **Docker + docker-compose** deployment with a persistent volume for the database.
- **No authentication by design** — intended for your private/home network only. See
  [Security](#security).

## Run with Docker (recommended)

```bash
cd server
docker compose up -d --build
```

- The server listens on port `3000` by default (override with `PORT`, e.g.
  `PORT=8080 docker compose up -d`).
- The SQLite database is stored in the `meter-data` named volume and survives container
  restarts and rebuilds.
- Health check: `curl http://localhost:3000/health` → `{"status":"ok",...}`.

To stop: `docker compose down` (add `-v` to also delete the data volume).

## Run without Docker

Requires **Node.js 24+** (for the built-in `node:sqlite` module and native TypeScript
type stripping).

```bash
cd server
npm install
DB_PATH=./data/meters.db PORT=3000 npm start   # runs src/server.ts directly
```

Type-check the sources with:

```bash
npm run typecheck   # tsc --noEmit
```

## Configuration

| Env var   | Default            | Description                       |
| --------- | ------------------ | --------------------------------- |
| `PORT`    | `3000`             | HTTP port to listen on.           |
| `DB_PATH` | `./data/meters.db` | Path to the SQLite database file. |

## Pointing devices at the server

1. Find the server's address on your LAN (e.g. `http://192.168.1.50:3000`).
2. On each device, open the app → **Settings** → set **Server URL** to that address →
   **Save & sync**.
3. Leaving the field empty disables sync; the app then works fully offline (Phase 1).

## API

All endpoints return JSON unless noted. Ids are always the client-generated UUIDs.

| Method & path                   | Purpose                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `GET /health`                   | Liveness check → `{ status, time }`.                                           |
| `GET /sync/changes?since=<ISO>` | Records changed strictly after `since` (all if empty).                         |
| `POST /sync/changes`            | Upsert `{ meters[], readings[] }` (last-write-wins).                           |
| `GET /photos/manifest`          | `{ ids: [...] }` of photo ids the server has.                                  |
| `GET /photos/:id`               | Photo binary with its stored `Content-Type` (404 if unknown).                  |
| `POST /photos`                  | Upload a photo (multipart: `id`, `readingId`, `mimeType`, `data`). Idempotent. |

Conflict resolution: on `POST /sync/changes` an incoming record overwrites the stored one
only when its `updatedAt >= stored.updatedAt`. Soft deletes (`deletedAt` set, `updatedAt`
bumped) propagate like any other edit. Photo blobs are immutable and transferred only when
the peer is missing them.

## Security

This server has **no authentication** and must only be run on your private/home network.
Do not expose it directly to the public internet.

If you ever need remote access, put it behind one of the following (not implemented here):

- a reverse proxy adding HTTPS + HTTP basic auth or a pre-shared token header, or
- a VPN into your home network.

The sync logic is structured so a single auth header could be required later without
changing how records are reconciled.
