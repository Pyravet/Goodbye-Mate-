# Goodbye Mate — Ops Platform

At-home pet euthanasia operations platform: admin dispatch/booking
dashboard, a field app for subcontracted vets, and a public client-facing
booking journey (consent, payment, aftercare), backed by a single Node/
Express/Postgres API.

## What's here

```
apps/
  web-admin/    Admin dashboard (jobs, vets, calendar, settings, activity)
  web-vet/      Vet PWA (job offers, calendar, earnings, profile)
  web-client/   Public client journey — no login, reached via a per-job link
  vet-native/   React Native/Expo version of the vet app
packages/
  web-shared/   Auth context, API client, push helpers, error boundary,
                and base theme shared by the three React web apps
server/
  src/routes/       HTTP endpoints, one file per resource
  src/domain/       Business logic (pricing, dispatch ranking) — no HTTP,
                     no DB calls; pure functions, directly unit-testable
  src/integrations/ Third-party services (email, SMS, WhatsApp, Slack,
                     payments, maps, push, AI drafting)
  src/db/           Migrations (numbered, sequential) + connection pool
  src/pdf/          RCTI/invoice/quote PDF generation
  src/workers/      Background jobs (dispatch offer timeout rollover)
  src/security/     Encryption helpers for sensitive fields (bank details)
docs/
  deployment.md     Hosting architecture, env vars, CORS, custom domain
```

## What's implemented

- **Jobs**: full booking CRUD, human-readable job numbers (`GM-0001`),
  task-gated completion (vet assigned + consent + payment + procedure +
  cremation-if-applicable, all required before a job can close), at-risk
  alerts, per-job admin↔vet messaging with a consolidated inbox view
- **Dispatch**: territory-ranked auto-offer to vets with real
  server-side timeout rollover (a background worker, not a client-side
  timer), territory matching via drawn polygons (point-in-polygon) with
  postcode-prefix fallback
- **Vets**: profile, ABN/GST, weekly + one-off availability, territory
  drawing, bank details (encrypted at rest)
- **Client journey**: public per-job link (consent form, eWay payment,
  cremation brochure with optional admin-uploaded PDF, post-visit star
  rating with a Google review handoff on 5 stars)
- **Payments & documents**: eWay client-side-encrypted card capture,
  RCTI/invoice/quote PDF generation and emailing
- **Notifications**: web push + Expo push for vets (job offers, new
  messages), web push + Slack for admin (en-route updates, new vet
  signups, new messages), SMS/WhatsApp via MSG91 (config-gated)
- **Settings**: pricing, client-facing content/brochures, message
  templates — all admin-editable

## Local setup

### 1. Database
```bash
cd server
cp .env.example .env
# fill in DATABASE_URL and generate real secrets:
#   openssl rand -base64 48   (for JWT_ACCESS_SECRET and JWT_REFRESH_SECRET)
```

### 2. Install & migrate
From the repo root (this installs all workspaces — server, all four
`apps/*`, and `packages/web-shared` — in one pass):
```bash
npm install
npm run migrate
```

### 3. Create an admin user
```bash
cd server
node src/db/seed-admin.js "you@goodbyemate.com.au" "some-temp-password" "Your Name"
```

### 4. Run the apps
```bash
# from repo root, separate terminals
npm run dev:server   # http://localhost:4000
npm run dev:admin    # http://localhost:5173
npm run dev:vet       # http://localhost:5174
npm run dev:client   # http://localhost:5175
```

## Deployment

See [`docs/deployment.md`](docs/deployment.md) — all four web
units are git-linked to auto-deploy from `main`.

## Security notes

- Refresh tokens: stored hashed (SHA-256), rotate on every use
- Passwords: bcrypt, cost factor 12
- Login rate-limited separately from the general API limit
- Bank details encrypted at rest; only masked digits ever shown again
- Consent/payment routes on the public client journey are rate-limited
  and gated by an unguessable per-job token (not by login)

Still outstanding: 2FA for admin accounts, dependency vulnerability
scanning in CI, a documented backup/restore policy, and a full review of
Australian Privacy Principles obligations for the health-adjacent pet
medical notes and payment data flowing through the system.
