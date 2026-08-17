# Deployment

## Architecture

Four deployable units, one Postgres database:

| Unit | Host | Deploys from |
|---|---|---|
| `server/` (API) | Railway | GitHub push to `main` (auto) |
| `apps/web-admin` | Vercel | GitHub push to `main` (auto) |
| `apps/web-vet` | Vercel | GitHub push to `main` (auto) |
| `apps/web-client` | Vercel | GitHub push to `main` (auto) |
| `apps/vet-native` | EAS (Expo) | manual build, not auto-deployed |

All three Vercel projects and the Railway service are **git-linked** —
pushing to `main` redeploys everything automatically. There's no manual
file-upload deploy step; if a project ever loses its git link, relink it
via the Vercel dashboard (Project → Settings → Git) rather than
uploading files directly, since hand-assembling a full file tree for a
multi-file app is slow and error-prone compared to letting Vercel build
straight from the repo.

## Environment variables

`apps/*/.env.production` files **are committed to git** — this is
deliberate, not an oversight. Every value in them (Google Maps browser
key, eWay *public* encryption key, VAPID *public* key, the API base URL)
ends up embedded in the client-side JS bundle regardless of whether the
file is gitignored, since these are Vite `VITE_*` build-time constants.
There's no actual secret being exposed by committing them, and doing so
means a git-linked Vercel deploy builds correctly without needing env
vars set by hand in each project's dashboard.

Real secrets (JWT signing keys, DB credentials, payment gateway private
keys, SMS/email provider keys) live only in Railway's environment
variables for the `server` service — never in git, never in a `VITE_*`
variable.

## CORS

The API's `CORS_ORIGIN` env var (Railway) must list every frontend
origin that calls it. When adding a new frontend deployment or domain,
update this list — a missing origin causes silent, hard-to-diagnose
failures (the browser blocks the request before it reaches the server,
so nothing shows up in server logs at all).

## Custom domain: care.goodbyemate.com.au

Intended for `apps/web-client` (the public client-journey app). Setup:

1. Vercel → `goodbye-mate-client-app` project → Settings → Domains → add
   `care.goodbyemate.com.au`
2. Vercel will show a CNAME target (typically `cname.vercel-dns.com`)
3. Add that CNAME record with whoever manages `goodbyemate.com.au`'s DNS
4. Once it resolves, update `VITE_CLIENT_APP_URL` in
   `apps/web-admin/.env.production` from the Vercel URL to
   `https://care.goodbyemate.com.au` and push

## Known gotcha: cross-site cookies

The API and frontends are on different domains (Railway vs. Vercel), so
the refresh-token cookie must be `SameSite=None; Secure` — `Lax` (the
default) silently fails to persist login across a page reload in this
setup, because browsers never attach `Lax` cookies to cross-site
`fetch()` calls. This is already fixed in `server/src/routes/auth.js`,
documented here so it doesn't get "fixed" back to `Lax` by mistake later.
