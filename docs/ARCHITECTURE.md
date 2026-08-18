# Architecture

Handover reference for Goodbye Mate: what runs where, how data moves, and
which environment variables each platform needs.

## 1. Deployment topology

This is **not** a serverless application, and that distinction drives
several design decisions below.

| Component | Runs on | Nature |
|---|---|---|
| API (`server/`) | Railway | One long-lived Node/Express process |
| Dispatch worker | Railway | Same process — a `setInterval` loop started in `index.js` |
| Admin / Vet / Client apps | Vercel | Static Vite SPA builds. **No serverless functions.** |
| Database | Neon | Serverless Postgres, reached over TCP with SSL |

Vercel serves static assets only; every `vercel.json` in this repo
contains nothing but an SPA rewrite. All API traffic goes from the
browser directly to the Railway domain.

**Why this matters:** serverless-oriented Postgres drivers
(`@neondatabase/serverless`, `@vercel/functions` `attachDatabasePool`)
exist to solve per-invocation connection churn. With a single persistent
process there is no such churn, and the Neon HTTP driver would break the
multi-statement transactions used in `routes/vets.js` and
`routes/auth.js`. A standard `pg` Pool is the correct choice here.

## 2. Request lifecycle

```
Browser (Vercel-hosted SPA)
  └─ fetch → https://<railway-domain>/api/...
       ├─ helmet, CORS allowlist, rate limits
       ├─ express.json  (20mb brochure path / 8mb journey path / 1mb global)
       ├─ requireAuth → verifies JWT access token
       ├─ requireRole('admin'|'vet')
       ├─ route handler (Zod validation → query → integrations)
       └─ central error handler
              └─ Neon Postgres (pooled TCP, SSL)
```

Body-parser ordering is load-bearing: whichever `express.json()` runs
first consumes the stream, so the larger per-path limits **must** be
mounted before the global 1mb parser. Mounting them after silently
produces 413s on uploads.

### Background worker
`workers/dispatchWorker.js` polls for expired job offers and rolls them
to the next-ranked vet. It runs **in the API process**, so it shares the
same connection pool — which is why the pool ceiling accounts for it.

### Client journey (public, unauthenticated)
`routes/publicJourney.js` is reached with no login, secured only by an
unguessable per-job UUID token sent to the client by SMS/email. It is
rate-limited (60 requests / 15 min) and scoped so a token only ever
exposes that one job.

## 3. Database schema

18 tables. Core relationships:

```
users ──1:1── vets ──┬─< jobs (assigned_vet_id)
  │                  └─< (dispatch_offered_vet_id)
  ├─< refresh_tokens
  ├─< push_subscriptions / expo_push_tokens
  └─< audit_log (actor_user_id)

jobs ─┬─< job_line_items      extras (+) and discounts (−)
      ├─< job_internal_messages   admin ↔ vet thread
      ├─< payments
      └──1:1 job_reviews

Singleton settings rows (id = true):
  pricing_settings · content_settings

Reference / content:
  message_templates · vet_note_templates
  content_documents (kind, state)  ← per-state cremation brochures
  client_resources                 ← grief resources & supporting docs
  messages                         ← client-facing message log
```

**Critical indexes**
- `jobs(client_token)` — unique; every client journey request looks up by it
- `job_line_items(job_id)` — read on every bill/payout calculation
- `client_resources(is_active, sort_order)` — journey page listing
- `content_documents` PK `(kind, state)` — state-specific brochure with
  `'ALL'` as the nationwide fallback

**Money handling:** amounts are stored in **dollars** (`NUMERIC(10,2)`),
consistent with `pricing_settings`. Do not mix in cents. Totals are
rounded to cents in `domain/pricing.js` to prevent float drift
(`0.1 + 0.2`) reaching an invoice.

## 4. Layering

```
routes/        HTTP: validation, auth, status codes
domain/        Pure business logic — no HTTP, no DB. Unit-tested.
integrations/  Third parties: email, SMS, WhatsApp, Slack, eWay, push, maps
db/            Pool, migrations, seeds
middleware/    auth, asyncHandler
security/      field-level encryption (bank details)
pdf/           RCTI / invoice / quote generation
workers/       background dispatch rollover
```

`domain/pricing.js` and `domain/dispatch.js` take data as arguments and
return values — no database access. That is deliberate: it's what makes
them directly unit-testable, and why the 28 tests cover them.

**Known debt:** `routes/jobs.js` is ~1,100 lines and mixes HTTP handling
with business logic. Extracting a service layer is worthwhile but should
be done **after** route-level integration tests exist — it touches
money, dispatch and notifications, none of which currently have
route-level coverage.

## 5. Connection pooling

Configured in `db/pool.js`:

| Setting | Value | Why |
|---|---|---|
| `max` | 8 (`PG_POOL_MAX`) | Neon caps connections per project; the API, worker, deploy-time migrations and any psql session share that quota |
| `idleTimeoutMillis` | 30s | Return sockets rather than holding them; Neon also closes idle connections server-side |
| `connectionTimeoutMillis` | 10s | Fail fast instead of piling up requests during a DB blip |
| `maxLifetimeSeconds` | 1800 | Recycle long-lived sockets that can die silently behind a proxy |

A `pool.on('error')` handler is registered: without it, an idle client
failing in the background emits an unhandled `'error'` event and **kills
the process** — which presents as a mysterious restart.

**Rule:** use the exported `query()` helper, which checks out and
releases automatically. Only use `pool.connect()` for transactions, and
always `client.release()` in a `finally` block. All five current
`pool.connect()` sites follow this pattern.

## 6. Error handling

`asyncHandler` wraps every route so rejected promises reach Express
rather than hanging the request.

The central handler distinguishes **deliberate** errors from unexpected
ones: an error carrying a 4xx status has its message passed through to
the client; anything else is logged in full server-side and returned as
a generic message. Stack traces and SQL never reach a client.

## 7. Environment variables

### Railway (API) — required
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection string (`?sslmode=require`) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Token signing. `openssl rand -base64 48`. Process refuses to start without these. |
| `CORS_ORIGIN` | Comma-separated allowlist of frontend origins. A missing origin fails **before** reaching the server, so it produces no server log — check here first when a frontend "can't connect". |
| `NODE_ENV` | `production` — also gates SSL and secure cookies |
| `CLIENT_APP_URL` | Base URL used to build client journey links |

### Railway — optional (features degrade gracefully if unset)
`EMAIL_SMTP_HOST` · `EMAIL_SMTP_PORT` · `EMAIL_USER` · `EMAIL_PASSWORD` ·
`MSG91_AUTH_KEY` · `MSG91_SENDER_ID` · `MSG91_WHATSAPP_INTEGRATED_NUMBER` ·
`MSG91_WHATSAPP_QUOTE_TEMPLATE` · `SLACK_WEBHOOK_URL` ·
`EWAY_API_KEY` · `EWAY_API_PASSWORD` · `EWAY_ENDPOINT` ·
`VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_CONTACT_EMAIL` ·
`GOOGLE_MAPS_API_KEY` · `ANTHROPIC_API_KEY` ·
`BANK_DETAILS_ENC_KEY` · `PG_POOL_MAX` · `DISPATCH_TIMEOUT_MINUTES` ·
`ADMIN_BOOTSTRAP_EMAIL` / `_PASSWORD` / `_NAME`

### Vercel (frontends)
Committed in each app's `.env.production`. These are **build-time
constants baked into the client bundle** — only ever put public values
here:

| Variable | Apps |
|---|---|
| `VITE_API_URL` | all three |
| `VITE_GOOGLE_MAPS_API_KEY` | admin, vet — restrict by HTTP referrer in Cloud Console |
| `VITE_EWAY_PUBLIC_API_KEY` | admin, client — eWay *public* encryption key |
| `VITE_VAPID_PUBLIC_KEY` | admin, vet — push *public* key |
| `VITE_CLIENT_APP_URL` | admin — for displaying journey links |

Private keys (VAPID private, eWay API key/password, JWT secrets, DB
credentials) belong **only** in Railway. A `VITE_`-prefixed secret is
published to every visitor.

### Local development
```bash
cp server/.env.example server/.env   # fill in DATABASE_URL + generate secrets
npm install                          # installs all workspaces
npm run migrate
npm run dev:server                   # :4000
npm run dev:admin                    # :5173
```

## 8. Deployment

All four units deploy from `main` on push:
- **Railway** runs migrations then the admin bootstrap as a pre-deploy
  step, so schema changes apply before the new code serves traffic.
- **Vercel** builds each app from its `rootDirectory`.

Graceful shutdown is wired to SIGTERM (which Railway sends on every
redeploy): the HTTP server drains, then the pool closes, with a 10s
forced-exit backstop.
