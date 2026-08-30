/**
 * When workers are allowed to touch the database.
 *
 * THE ROOT CAUSE OF THE QUOTA OUTAGE. Neon bills COMPUTE TIME, not
 * queries, and suspends the compute after roughly five minutes idle.
 * Polling every 30 seconds meant it never suspended once — 720
 * compute-hours a month against an allowance of about 191. Exhausted
 * around day 8, every month, guaranteed. The query volume itself
 * (~4,300/day) was never the problem.
 *
 * The fix is not "poll less often" but "leave gaps long enough for the
 * database to actually sleep". A 30-second poll and a 4-minute poll both
 * keep it awake permanently; only a real gap helps.
 *
 * So: work in BURSTS during hours when something might plausibly need
 * doing, and stay completely off the database otherwise.
 */

const TZ = 'Australia/Melbourne';

/** Hour of day in the business's timezone, 0–23. */
export function businessHour(now = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', hour12: false })
      .format(now)
  ) % 24;
}

/**
 * Is this an hour when a worker should run at all?
 *
 * Dispatch offers roll over on a timer, and reminders go out before
 * appointments — neither is useful at 4am, when no vet is being offered
 * work and no client should be texted. Between 6am and 11pm the workers
 * run; outside that they don't touch the database, which is what lets
 * the compute suspend overnight.
 *
 * That's roughly 7 hours a night of genuine idle time, every night.
 * Combined with the burst pattern below it takes the monthly compute
 * from "always on" to a fraction of it.
 *
 * A job booked at 3am is unaffected: dispatch also runs on job creation
 * and on a vet responding. The worker only handles TIMED rollovers, and
 * an offer expiring at 4am can roll at 6am without anyone noticing.
 */
export function withinWorkingHours(now = new Date()) {
  const h = businessHour(now);
  return h >= 6 && h < 23;
}

/**
 * Should this tick actually query, or skip?
 *
 * Workers tick often (so they respond quickly when there IS work) but
 * only query in a short burst at the top of each window. Between bursts
 * they do nothing at all, and the database is left alone long enough to
 * suspend.
 *
 * @param {number} windowMinutes how often a burst is allowed
 * @param {number} burstSeconds how long a burst lasts
 */
export function createBurstGate({ windowMinutes = 10, burstSeconds = 90 } = {}) {
  let windowStart = 0;
  let burstUntil = 0;

  return {
    /**
     * @param {boolean} [force] run regardless — used when something has
     *   actually happened, so a real event never waits for a window.
     */
    allow(force = false, now = Date.now()) {
      if (force) return true;
      if (!withinWorkingHours(new Date(now))) return false;

      // Inside the current burst: keep going.
      if (now < burstUntil) return true;

      // Time for a new burst?
      if (now - windowStart >= windowMinutes * 60_000) {
        windowStart = now;
        burstUntil = now + burstSeconds * 1000;
        return true;
      }
      return false;
    },
  };
}

/**
 * Rough compute-hours per month for a given pattern, for sanity-checking
 * a change before it ships. Assumes the database stays awake for five
 * minutes after any query, which is Neon's default suspend delay.
 */
export function estimateComputeHours({ windowMinutes, burstSeconds, activeHoursPerDay }) {
  const burstsPerDay = (activeHoursPerDay * 60) / windowMinutes;
  // Each burst keeps the compute alive for its own length plus the
  // 5-minute suspend delay that follows it.
  const awakeSecondsPerBurst = burstSeconds + 5 * 60;
  return Math.round((burstsPerDay * awakeSecondsPerBurst * 30) / 3600);
}
