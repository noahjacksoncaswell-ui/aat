# AAT Launch Operations Division (LOD) Management Platform

Single source of truth for AAT's Launch Operations Division: launch site
geospatial/weather intelligence, mission scheduling and countdown tracking,
FAA/airspace authorization compliance, and launch documentation management.

Built against `AAT LOD Platform — Technical Build Specification v2.0`.

## Stack

- **API**: Node.js / TypeScript / Express, PostgreSQL via Prisma ORM, JWT auth
  (access + rotating refresh tokens), Socket.io for live updates.
- **Web**: React + TypeScript (Vite), Tailwind CSS, React Query, React Leaflet.
- **Storage**: S3-compatible object storage for documents, with automatic
  fallback to local disk when no S3 credentials are configured (so the
  platform runs out of the box in local/dev environments).
- **Weather**: NOAA/NWS API for US sites (no key required), OpenWeatherMap as
  a configurable fallback/non-US provider.

## Repository layout

```
server/   Express API, Prisma schema + migrations, seed data
web/      React frontend (Vite)
docker-compose.yml   Local Postgres + MinIO (S3-compatible) for development
```

## Local setup

### 1. Database (and optional object storage)

Either run the provided compose stack:

```bash
docker compose up -d
```

...or point `DATABASE_URL` at any PostgreSQL 14+ instance you already have
running. PostGIS is included in the compose image for future geospatial
features, but the current schema only requires plain PostgreSQL.

### 2. API server

```bash
cd server
cp .env.example .env      # edit DATABASE_URL / secrets as needed
npm install
npm run prisma:migrate    # creates schema
npm run prisma:seed       # seeds demo users, a site, a vehicle, and a mission
npm run dev                # http://localhost:4000
```

Seeded login credentials (password `AAT-LOD-2026!` for all):

| Role            | Email                              |
|-----------------|-------------------------------------|
| Admin           | admin@aat-aerospace.example         |
| Launch Director | ld@aat-aerospace.example            |
| Operator        | ops@aat-aerospace.example           |
| Viewer          | viewer@aat-aerospace.example        |

### 3. Web app

```bash
cd web
npm install
npm run dev                # http://localhost:5173 (proxies /api and /socket.io to :4000)
```

## Roles (RBAC)

- **Admin** — full access: users, sites, vehicles, COAs, all missions/documents.
- **Launch Director** — confirms/postpones/cancels/scrubs missions, logs flight
  disposition, and is the only role (with Admin) permitted to satisfy FAA
  launch-day notification checklist items. This gate is enforced **server-side**
  in `server/src/middleware/auth.ts` and the mission/notification routes, not
  just hidden in the UI.
- **Operator** — console-level access: GO/NO-GO polling, milestone updates,
  mission log entries, document uploads.
- **Viewer** — read-only.

## Notable design decisions

- **Document storage** abstracts over S3 vs. local disk (`server/src/services/storage.ts`)
  so the app is usable without cloud credentials in development; swapping in
  `S3_*` env vars is a drop-in upgrade with no code changes.
- **COA / NOTAM status** are computed server-side from stored effective/expiration
  dates rather than stored as a mutable field, so they can never drift out of
  sync with "today." See `server/src/services/faa.ts`.
- **Mission workflow** (Target → Postpone/Cancel/Scrub → Disposition) and its
  guard rails (e.g. Scrub only after a target is confirmed; no Postpone/Cancel
  once Scrubbed/Successful; FAA/Airspace GO blocked until the 3-item launch-day
  checklist is satisfied) live in `server/src/routes/missions.ts` and are
  enforced independent of the UI.
- **Mission history** is append-only (`MissionHistoryEvent`), matching standard
  range/flight-test recordkeeping practice.
- **Live updates** use Socket.io rooms per mission plus a shared dashboard room;
  the frontend also polls key endpoints as a fallback.

## Known follow-ups (out of scope for this pass)

- Full-text/OCR search over PDF contents (spec calls this a stretch goal).
- Offline caching for the countdown/notification checklist on poor connectivity.
- Approval workflow sign-off chain for documents (Draft → Submitted → Reviewed → Approved)
  beyond the current single `status` field.
- FAA airspace class boundary map overlays (spec notes no public real-time COA
  API exists yet; COA data is intentionally architected as manually-entered
  with automatic date-based status evaluation, ready for a future feed).
