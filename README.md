# Goodbye Mate — Ops Platform

## Phase 2 status (this checkpoint) — core domain

Jobs, pricing, and dispatch — ported field-for-field from the prototype's
validated business logic, now running against the real database with real
server-side scheduling (no more client-side timers).

**Implemented:**
- **Pricing** (`domain/pricing.js`): client bill breakdown, vet payout
  breakdown, GST extraction from a GST-inclusive total — same formulas as
  the prototype. Editable via `/api/settings/pricing`.
- **Jobs** (`routes/jobs.js`): full CRUD, human-readable job numbers
  (`GM-0001`, via a real Postgres sequence), Today/Upcoming/Past/Board
  views with search, task-gated completion (vet assigned + consent signed
  + payment received + procedure done + cremation booked if applicable —
  all required before a job can be marked complete, matching the brief
  exactly), at-risk alerts computed on demand, per-job internal
  admin↔vet messaging thread.
- **Dispatch** (`domain/dispatch.js` + `domain/vetContext.js`): vet
  ranking by territory match + availability + workload + time-conflict,
  auto-offer with real server-side timeout rollover (a background worker
  checking every 30s — replaces the prototype's client-side timer, which
  only ran while an admin had the tab open). Territory matching now
  prefers the real polygon from Phase 1's maps work (point-in-polygon)
  when a vet has one drawn and the job has real coordinates, falling back
  to postcode-prefix matching otherwise.
- **Vets**: full profile (registration, ABN/GST, postcodes, weekly
  hour-by-hour availability, one-off date overrides, personal note
  templates), vet creation also provisions their login user.
- **Settings**: pricing, client-journey content, and message templates,
  all admin-editable and matching the prototype's defaults exactly.

**Not yet built:** the actual admin/vet UI screens for any of this (jobs
board, vet management, calendar, settings pages) — Phase 1's admin app is
still just a login + placeholder dashboard. This phase was backend-first
so the business logic is correct before UI is built on top of it. Also
still open: RCTI/invoice/receipt PDF generation, the Enquiries/quotations
inbox, WhatsApp/Slack/Outlook integrations, vet account setup/invite flow
(vets are created with an unusable random password right now — no
"set your password" email flow exists yet), and public holidays in the
weekday/after-hours time-category logic (currently just weekday vs
weekend/evening, matching the prototype — AU public holidays per state
aren't modeled).

### A note on the dispatch worker
`workers/dispatchWorker.js` runs an in-process `setInterval` — correct for
a single API instance, but if this ever scales to multiple instances it
needs to move to a proper scheduler (dedicated worker process or a
Postgres-backed queue) so rollover doesn't fire redundantly from every
instance. Fine to leave as-is until that's actually a consideration.



Real auth, real Postgres, deploy-ready skeleton. Nothing job/vet/pricing-related
yet — that's Phase 2, built on top of this foundation.

**Implemented:**
- Postgres schema: `users`, `refresh_tokens`, `audit_log`, migration runner
- Auth: bcrypt password hashing, short-lived JWT access tokens + rotating
  httpOnly refresh-token cookies, role-based middleware (`admin` / `vet`)
- Security baseline: helmet, CORS locked to the admin app's origin, rate
  limiting (global + stricter on `/auth/login`), generic auth error messages
  (no user enumeration), audit log table with a `logAction` helper wired
  into login attempts
- Minimal admin web app: login page, protected dashboard placeholder,
  auto-refresh-and-retry on the API client so a session survives an
  access-token expiry without booting the user out

**Also implemented (Maps, kicked off early once a Google API key was provided):**
- `vets` table with a real PostGIS `GEOGRAPHY(POLYGON)` territory column
  (not a postcode list) + spatial index
- Admin API: save/get a vet's territory as GeoJSON, and a `/vets/matching`
  lookup (which vets' territories contain a given lng/lat) — this is the
  query Phase 2's dispatch logic will call once jobs exist
- Frontend: `AddressAutocomplete` (real Google Places autocomplete,
  restricted to Australia) and `TerritoryMap` (draw a polygon per vet with
  Google's Drawing library, save/clear/redraw) — not yet wired into a page,
  ready to drop into the vet management screen in Phase 2

**Not yet built:** jobs, pricing, dispatch, calendar, payments, PDFs,
notification channels, enquiries/quotes, AI features, vet portal. See
`goodbye_mate_handoff_brief.md` for the full feature set.

### A note on PostGIS
Both Neon and Supabase support the PostGIS extension, but on Neon you may
need to enable it per-project in their dashboard before `npm run migrate`
will succeed on migration 002. If it fails with a "extension postgis is
not available" error, that's what to check first.

## Local setup

### 1. Database
Create a Postgres database (local, or a free Neon/Supabase project — either
works for dev).

```bash
cd server
cp .env.example .env
# edit .env: set DATABASE_URL, and generate real secrets:
#   openssl rand -base64 48   (run twice, for JWT_ACCESS_SECRET and JWT_REFRESH_SECRET)
```

### 2. Install & migrate
From the repo root:

```bash
npm install
npm run migrate
```

### 3. Create the first admin user

```bash
cd server
node src/db/seed-admin.js "you@goodbyemate.com.au" "some-temp-password" "Your Name"
```

### 4. Run both apps

```bash
# from repo root, two terminals
npm run dev:server   # http://localhost:4000
npm run dev:admin    # http://localhost:5173
```

Log in at `localhost:5173` with the admin credentials from step 3.

## Deployment (target shape, once you're ready)

- **API**: Vercel (serverless functions) or a small always-on host (Railway/
  Render) — Express with long-lived DB connections works better on an
  always-on host than serverless; worth deciding once traffic patterns are
  known. Set all vars from `server/.env.example` in the hosting dashboard.
- **DB**: Neon or Supabase Postgres. Run `npm run migrate` against the prod
  `DATABASE_URL` after provisioning.
- **Admin app**: Vercel static/SPA deploy from `apps/web-admin`, `VITE_API_URL`
  pointed at the deployed API.
- **DNS**: CNAME `ops.goodbyemate.com.au` → the hosting provider's target once
  the API + admin app are both live.

## Security notes for this phase

- Refresh tokens are stored hashed (SHA-256) in `refresh_tokens`, never in
  plaintext — a DB leak alone doesn't hand out valid sessions.
- Refresh tokens rotate on every use (old one revoked, new one issued) —
  limits the blast radius if one is ever stolen.
- Passwords are bcrypt-hashed with a cost factor of 12.
- Login is rate-limited (10 attempts / 15 min / IP) separately from the
  general API rate limit.
- `audit_log` currently records login success/failure; Phase 2 will extend
  this to job changes, payment events, and bank-detail edits — the pattern
  (`logAction`) is already in place to build on.

**Google Maps API key**: restrict it in Google Cloud Console to your actual
domains (HTTP referrer restriction) and to only the APIs you need (Maps
JavaScript, Places, Geocoding) before it's used anywhere public. Never commit
a real key into the repo — it only ever belongs in your local `.env` /
`.env.local` files and your hosting provider's environment variable settings.

Still outstanding for a full security pass (tracked for the dedicated
hardening phase, not blocking Phase 1): 2FA for admin accounts, dependency
vulnerability scanning in CI, backup/restore policy, and a review of the
Australian Privacy Principles obligations once client health-adjacent data
(pet medical notes) and payment data are flowing through the system.
