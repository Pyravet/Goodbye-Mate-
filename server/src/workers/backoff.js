/**
 * Back off when the database is refusing work.
 *
 * The dispatch worker polls every 30s and the reminder worker every 60s.
 * When Postgres was out of compute quota they kept polling anyway,
 * failing thousands of times a day — burning the very quota that was
 * exhausted, and filling the log so thoroughly that the ONE line that
 * mattered (a failing login) was buried among identical worker errors.
 *
 * Also: nobody was told. Both workers only console.error'd, so the first
 * anyone knew the system was down was a person unable to sign in.
 */
import { alertCrash } from '../monitoring/alerts.js';

// Doubles from one minute to an hour. Long enough to stop hammering a
// quota-exhausted database, short enough to recover on its own once the
// quota resets rather than needing a restart.
const MIN_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;

export function createBackoff(label) {
  let until = 0;
  let delay = MIN_BACKOFF_MS;
  let alerted = false;

  return {
    /** True when the worker should skip this tick. */
    shouldSkip() {
      return Date.now() < until;
    },

    /** Record a failure and widen the pause. */
    fail(err) {
      const message = String(err?.message || err);
      // Quota and connection failures mean the database itself is
      // unavailable — retrying in 30s cannot help. Other errors are
      // likely specific to one job, so they don't trigger a backoff.
      const infra = /compute time quota|too many connections|ECONNREFUSED|terminating connection/i
        .test(message);
      if (!infra) return false;

      until = Date.now() + delay;
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);

      // Alerted ONCE per outage, not per tick — the whole point is to
      // stop the noise, and an alert per 30s would be muted immediately.
      if (!alerted) {
        alerted = true;
        alertCrash(`${label} stopped — database unavailable`, err);
      }
      return true;
    },

    /** A tick succeeded: the outage is over. */
    ok() {
      if (alerted) {
        alertCrash(`${label} recovered`, new Error('database is responding again'));
      }
      until = 0;
      delay = MIN_BACKOFF_MS;
      alerted = false;
    },
  };
}
