import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

/**
 * Postgres connection pool.
 *
 * Deployment context matters here: the API runs as a SINGLE long-lived
 * Express process on Railway, not as per-request serverless functions.
 * That makes a standard TCP `pg` Pool the correct choice — the
 * serverless-oriented drivers (Neon HTTP/WebSocket, @vercel/functions
 * attachDatabasePool) exist to solve per-invocation connection churn we
 * don't have, and the HTTP driver would additionally break the
 * multi-statement transactions used in vets.js and auth.js.
 *
 * The limits below matter because Neon caps concurrent connections per
 * project (tier-dependent, and low on the smaller plans). Without an
 * explicit `max`, node-postgres defaults to 10 per process — which is
 * survivable for one process, but leaves no headroom for the background
 * dispatch worker, migrations running at deploy time, and any manual
 * psql session, all of which share the same Neon quota.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // Neon (and most hosted Postgres) require SSL outside local dev.
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,

  // Ceiling on concurrent connections from this process. Deliberately
  // conservative: this app is I/O-bound on a small instance, and
  // exhausting Neon's project-wide limit takes down migrations and the
  // worker too, not just a request.
  max: Number(process.env.PG_POOL_MAX) || 8,

  // Return idle connections to Neon rather than holding sockets open.
  // Neon also closes idle connections server-side; reaping them here
  // first avoids handing a half-dead socket to a request.
  idleTimeoutMillis: 30_000,

  // Fail fast instead of hanging forever if the pool is saturated or the
  // database is unreachable — an unbounded wait turns a brief DB blip
  // into every request piling up until the process falls over.
  connectionTimeoutMillis: 10_000,

  // Recycle connections periodically. Guards against long-lived sockets
  // silently dying behind a proxy/load balancer, which surfaces as
  // intermittent "Connection terminated unexpectedly" errors.
  maxLifetimeSeconds: 1800,
});

/**
 * Pool-level errors fire for idle clients failing in the background (a
 * dropped TCP connection, a Neon restart). Without this listener,
 * node-postgres emits an 'error' event with no handler, which crashes
 * the process — the exact failure mode that looks like a random restart.
 */
pool.on('error', (err) => {
  console.error('Unexpected idle client error (connection will be discarded):', err.message);
});

/**
 * Run a parameterised query using a pooled connection.
 *
 * Always prefer this over `pool.connect()` — it checks a client out and
 * releases it automatically, so it cannot leak. Use `pool.connect()`
 * only when you need multiple statements on the SAME connection (i.e. a
 * transaction), and always release it in a `finally` block.
 *
 * @param {string} text  SQL with $1-style placeholders. Never interpolate
 *   user input into this string — pass it via `params` instead.
 * @param {unknown[]} [params] Values bound to the placeholders.
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Close the pool during graceful shutdown so in-flight queries finish
 * and Neon reclaims the connections immediately, rather than waiting for
 * them to time out after the process is gone.
 */
export async function closePool() {
  await pool.end();
}
