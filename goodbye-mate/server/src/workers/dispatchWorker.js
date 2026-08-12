import { query } from '../db/pool.js';
import { startOrRollDispatch } from '../routes/jobs.js';

const CHECK_INTERVAL_MS = 30 * 1000;

// Replaces the prototype's client-side setInterval tick (which only ran
// while someone had the admin tab open). This runs in the API process
// itself. Fine for a single-instance deploy; if the API ever scales to
// multiple instances, this needs to move to a proper scheduler (e.g. a
// dedicated worker process, or a Postgres-backed job queue) so the
// rollover doesn't fire redundantly from every instance.
export function startDispatchWorker() {
  setInterval(async () => {
    try {
      const { rows } = await query(
        `SELECT id FROM jobs WHERE dispatch_state = 'offered' AND dispatch_expires_at < now()`
      );
      for (const job of rows) {
        await startOrRollDispatch(job.id);
      }
    } catch (err) {
      console.error('Dispatch worker error:', err);
    }
  }, CHECK_INTERVAL_MS);

  console.log(`Dispatch rollover worker started (checking every ${CHECK_INTERVAL_MS / 1000}s)`);
}
