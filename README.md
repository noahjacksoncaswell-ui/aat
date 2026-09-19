# AAT Launch Operations Division (LOD) Management Platform

Single source of truth for AAT's Launch Operations Division: launch site
geospatial/weather intelligence, mission scheduling and countdown tracking,
FAA/airspace authorization compliance, and launch documentation management.

Built against `AAT LOD Platform — Technical Build Specification v2.0`, revised
per `Revision Directive v3.0` (visual system, mission action logic, the LWCC
weather-commit module, the Vehicle Registry, and the L-COUNT/T-COUNT/P-COUNT
countdown system).

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

## Revision Directive v3.0 highlights

- **Mission actions** (`server/src/routes/missions.ts`): Postpone Indefinitely
  voids every open Launch Period entry, not just the targeted one; Cancel is
  available at any status short of Successful and requires typing the mission
  designator (checked server-side, not just in the UI) as a second
  confirmation; Scrub is gated to the day of a confirmed target and resets
  the countdown reference atomically in the same transaction as the scrub.
- **Countdown system** (`server/src/routes/countdown.ts`,
  `server/src/services/countdown.ts`): the L-COUNT/T-COUNT/P-COUNT three-clock
  model, LOT submission/revision, programmed and called holds, recycle, and
  mark-liftoff. T-COUNT is hold-aware and "drifts" later by exactly the
  realized duration of every released hold, the way a real procedure-driven
  clock does; the frontend ticks it locally between polls of `/countdown/state`.
- **LWCC module** (`server/src/services/lwcc.ts`, `server/src/routes/lwcc.ts`,
  `web/src/components/LwccTab.tsx`): LWCCR 3–22 requirement definitions, live
  evaluation against station weather for measurable parameters, manual
  reporting for requirements needing human observation, timed holds, a
  compliance banner, a permanently-retained activity log (clearing it only
  clears the visible view, per `Mission.lwccLogClearedAt`), and a
  justification-gated override.
- **Vehicle Registry** (`web/src/pages/Vehicles.tsx`): reuses the Documentation
  Library's storage for the photo/schematic gallery (`Document.vehicleId`)
  rather than a separate upload mechanism.
- **Visual system**: dark-mode-only (no toggle, no `prefers-color-scheme`
  handling), zero border radius enforced at the Tailwind theme-token level,
  and color restricted to four fixed status tones plus a restrained red for
  destructive actions - see `web/tailwind.config.js` and `web/src/index.css`.

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
- LWCC live evaluation uses NWS current-conditions data as a practical proxy
  for parameters the standard defines geometrically (precipitation/lightning
  *proximity*, cloud *coverage and vertical extent*) - there is no upper-air
  or radar feed wired in, so those rows are intentionally MANUAL (station-
  reported) rather than live. See the header comment in `server/src/services/lwcc.ts`.
- Dark mode's toggle, `matchMedia` check, and stored preference are fully
  removed (Section 1.7), but some components still pair a light-mode Tailwind
  utility with its `dark:` override in the same className (e.g.
  `bg-white dark:bg-slate-900`) rather than a single unprefixed class. Since
  `dark` is now permanently set on `<html>`, the light-mode utility never
  renders and is dead weight, not a behavioral gap - a mechanical follow-up
  pass could collapse these to single classes if desired.
