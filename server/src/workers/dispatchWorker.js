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
        `SELECT id, dispatch_offered_vet_id FROM jobs
         WHERE dispatch_state = 'offered' AND dispatch_expires_at < now()`
      );
      for (const job of rows) {
        // Mark the lapsed offer BEFORE rolling on. startOrRollDispatch
        // overwrites dispatch_offered_vet_id, so after that call there's
        // no way to tell who let it expire — and an ignored offer is a
        // reliability signal, not a non-event.
        if (job.dispatch_offered_vet_id) {
          await query(
            `UPDATE vet_job_offers
             SET outcome = 'expired', responded_at = now(),
                 response_seconds = EXTRACT(EPOCH FROM (now() - offered_at))::int
             WHERE id = (
               SELECT id FROM vet_job_offers
               WHERE job_id = $1 AND vet_id = $2 AND outcome = 'offered'
               ORDER BY offered_at DESC LIMIT 1
             )`,
            [job.id, job.dispatch_offered_vet_id]
          ).catch((e) => console.error('Could not record expired offer:', e.message));
        }
        await startOrRollDispatch(job.id);
      }
    } catch (err) {
      console.error('Dispatch worker error:', err);
    }
  }, CHECK_INTERVAL_MS);

  console.log(`Dispatch rollover worker started (checking every ${CHECK_INTERVAL_MS / 1000}s)`);
}
