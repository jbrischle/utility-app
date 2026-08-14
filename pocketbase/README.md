# PocketBase

Sync backend for the [app](../app). https://pocketbase.io/docs/

## First run

```bash
cp .env.example .env   # then set a real PB_ADMIN_PASSWORD (8+ characters)
docker compose up -d
```

`.env` is gitignored and is the **source of truth** for the superuser: it is re-applied on
every start, so changing the password in the Dashboard is undone by the next restart.
Changing it here revokes every device at once, because PocketBase tokens are stateless
JWTs with no server-side revocation.

**The password must be at least 8 characters.** If it is not, the container exits instead
of starting. That guard is deliberate: `pocketbase superuser upsert` prints its rejection
and then exits 0, so without it the stack comes up _healthy and completely locked_ — no
Dashboard access, and therefore no way to create the app accounts either, which reads like
a client bug rather than a server one.

## Dashboard

http://127.0.0.1:8090/_/

## RESTish API

http://127.0.0.1:8090/api/

## Accounts

There is no self-signup: `utility_users` has a superuser-only create rule, so accounts are
created by hand in the Dashboard. All accounts share one dataset — an account answers "who
may connect", not "whose data is this" — so anyone you create a login for can edit every
record.

## Schema notes

- Record ids are client-generated UUID v4 strings, not PocketBase's default 15-character
  ids. The `id` field's pattern and length are overridden accordingly.
- Records carry the app's own `createdAt` / `updatedAt` / `deletedAt` text fields alongside
  PocketBase's `created` / `updated` autodates. The app's are the edit clock used to
  resolve conflicts; PocketBase's drive the pull cursor and are indexed for it.
- `utility_readings.producedTracked` exists because PocketBase number fields cannot hold
  null, and the app distinguishes "fed nothing back" (`0`) from "does not measure feed-in"
  (`null`).
- Deletes are soft. `deleteRule` is superuser-only, so tombstones accumulate. Purging one
  from the Dashboard is genuinely dangerous: any device still holding the record will
  resurrect it on its next sync.

## Exposure

The API is reachable only from the tailnet. Three settings are left at their defaults
_because of that boundary_, and all three should be revisited together if the server is
ever exposed publicly:

- the `photo` file field is **not protected**, so file URLs need no token,
- CORS `--origins` is left as `*`,
- the rate limiter is off — and enabling it requires setting the trusted proxy headers
  first, or every client behind the proxy counts as one and throttles the household
  together.
