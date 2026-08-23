# Route-level tests

These run against a **real PostgreSQL database**, not mocks.

## Why a real database

Every money bug this project has had was in the SQL or in how a route
wired data together — a mismatched placeholder count, a bill computed
without line items, a status guard that didn't guard. A mocked database
would have let all of them through, because the mock returns whatever the
test author assumed. These tests are only worth having if they exercise
the actual queries.

## Running them

They need a throwaway database. `resetDb()` **truncates every table**, so
never point this at anything you care about.

```bash
# 1. Any Postgres will do — local, Docker, or a scratch Neon branch
createdb gm_test

# 2. Load the schema
DATABASE_URL="postgresql://localhost/gm_test" npm run migrate

# 3. Run
DATABASE_URL="postgresql://localhost/gm_test" \
JWT_ACCESS_SECRET=test-secret-at-least-32-chars-long \
JWT_REFRESH_SECRET=test-secret-2-at-least-32-chars \
npm run test:routes
```

Requires the `pgcrypto` and `postgis` extensions (migration 001 creates
them; the Postgres install needs `postgresql-<v>-postgis-3`).

## The scripts

| Script | Needs a DB | What it covers |
|---|---|---|
| `npm test` | no | Unit tests only — safe anywhere |
| `npm run test:unit` | no | Pricing, payouts, dispatch, encryption, SMS |
| `npm run test:routes` | **yes** | Money paths against real SQL |
| `npm run test:all` | yes | Both |

`npm test` deliberately excludes the route tests so it still works on a
machine with no Postgres, rather than failing confusingly.

## What's covered

Each test corresponds to a bug that reached production, or an invariant
whose violation costs real money:

- Bills include line items (clients were once quoted one total and
  charged another)
- Discounts reduce the client bill but not the vet's payout
- After-hours jobs use the higher rate on both sides
- A failed payment never marks a job paid
- Refunds are negative ledger rows; the original charge is never mutated
- Partial refunds leave a job paid; only a full refund flips it
- **RCTI numbers never collide under concurrent allocation**
- Approved payout totals are frozen against later price changes
- GST components always sum exactly to the total
- A vet cannot be paid twice for the same week

## Adding tests

Use the helpers in `helpers.js` — `createJob()` has sensible defaults so
each test only states what it actually cares about.

**Check your expected values against the real engine before asserting
them.** The first version of these tests failed on four assertions
because the author assumed `euthanasia_only` had no transfer fee. It
does. The code was right and the test was wrong.
