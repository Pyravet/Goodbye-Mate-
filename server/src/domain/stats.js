/**
 * Pure aggregation for the admin statistics dashboard.
 *
 * These take an already-priced array of jobs — each one run through
 * billBreakdown so its `billTotal` is the real, final figure a client
 * was actually charged — and group them by time, location or vet.
 *
 * MONEY IS NEVER COMPUTED HERE. billTotal must already be on each row
 * before it reaches this module. Reimplementing the pricing rules in
 * SQL or in a second JS function is exactly how a dashboard ends up
 * disagreeing with the invoices and RCTIs the business actually issued
 * — this module only sums a number that was computed once, by the one
 * function everything else in the app already trusts.
 */

/** YYYY-MM-DD -> Date, tolerating a Date object already. */
function toDate(d) {
  return d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00`);
}

function isoWeekKey(date) {
  // ISO week: Thursday of the week decides which year/week it belongs
  // to, which is what makes week numbering consistent across a year
  // boundary rather than week 1 sometimes meaning different things.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The bucket key for a job's date, at the requested granularity. */
export function periodKey(jobDate, granularity) {
  const d = toDate(jobDate);
  if (granularity === 'year') return String(d.getFullYear());
  if (granularity === 'week') return isoWeekKey(d);
  // month (default)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Jobs and revenue bucketed by time period.
 *
 * Completed/cancelled/other are counted SEPARATELY rather than folded
 * into one "jobs" number — "how many jobs this month" means something
 * different depending on whether a reader expects that to include
 * cancellations, and guessing wrong either way misleads them.
 *
 * @param {Array<{job_date, status, billTotal, cancellation_fee, refunded_amount}>} jobs
 * @param {'week'|'month'|'year'} granularity
 */
export function statsByPeriod(jobs, granularity = 'month') {
  const buckets = new Map();
  for (const job of jobs) {
    const key = periodKey(job.job_date, granularity);
    if (!buckets.has(key)) {
      buckets.set(key, { period: key, total: 0, completed: 0, cancelled: 0, other: 0, revenue: 0, cancellationFees: 0, refunded: 0 });
    }
    const b = buckets.get(key);
    b.total += 1;
    if (job.status === 'completed') {
      b.completed += 1;
      // Revenue is realised on COMPLETION — the same point commission
      // and vet payout eligibility are decided at, elsewhere in this
      // app. A still-open job hasn't actually happened yet.
      b.revenue += Number(job.billTotal) || 0;
    } else if (job.status === 'cancelled') {
      b.cancelled += 1;
      b.cancellationFees += Number(job.cancellation_fee) || 0;
    } else {
      b.other += 1;
    }
    b.refunded += Number(job.refunded_amount) || 0;
  }
  return [...buckets.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

/**
 * Completed-job revenue and count by a location field (state, postcode,
 * or suburb — caller decides via `field`).
 *
 * Only COMPLETED jobs count toward revenue and are what "per location"
 * normally means to someone asking "where is the money coming from" —
 * a cancelled job in a suburb didn't generate anything. Job counts
 * (including non-completed) are also kept so operational questions
 * ("where do we get the most enquiries") aren't silently answered with
 * the revenue-only subset.
 */
export function statsByLocation(jobs, field = 'state') {
  const buckets = new Map();
  for (const job of jobs) {
    const key = job[field] || 'Unknown';
    if (!buckets.has(key)) buckets.set(key, { location: key, totalJobs: 0, completedJobs: 0, revenue: 0 });
    const b = buckets.get(key);
    b.totalJobs += 1;
    if (job.status === 'completed') {
      b.completedJobs += 1;
      b.revenue += Number(job.billTotal) || 0;
    }
  }
  return [...buckets.values()].sort((a, b) => b.revenue - a.revenue);
}

/**
 * Per-vet completed job count and revenue they GENERATED (the client
 * bill total, not their own payout — "how much business did this vet
 * bring in" and "how much was this vet paid" are different questions;
 * the payout figure already exists on the vet payout pages, so this
 * stays on the first one to avoid the two numbers being read as the
 * same thing side by side).
 */
export function statsByVet(jobs) {
  const buckets = new Map();
  for (const job of jobs) {
    if (!job.assigned_vet_id) continue;
    const key = job.assigned_vet_id;
    if (!buckets.has(key)) {
      buckets.set(key, { vetId: key, vetName: job.vetName || 'Unknown', totalJobs: 0, completedJobs: 0, revenue: 0 });
    }
    const b = buckets.get(key);
    b.totalJobs += 1;
    if (job.status === 'completed') {
      b.completedJobs += 1;
      b.revenue += Number(job.billTotal) || 0;
    }
  }
  return [...buckets.values()].sort((a, b) => b.revenue - a.revenue);
}

/** Headline figures for the top of the dashboard. */
export function summaryStats(jobs) {
  const completed = jobs.filter((j) => j.status === 'completed');
  const cancelled = jobs.filter((j) => j.status === 'cancelled');
  const revenue = completed.reduce((sum, j) => sum + (Number(j.billTotal) || 0), 0);
  const cancellationFees = cancelled.reduce((sum, j) => sum + (Number(j.cancellation_fee) || 0), 0);
  const refunded = jobs.reduce((sum, j) => sum + (Number(j.refunded_amount) || 0), 0);
  return {
    totalJobs: jobs.length,
    completedJobs: completed.length,
    cancelledJobs: cancelled.length,
    revenue: Math.round(revenue * 100) / 100,
    cancellationFees: Math.round(cancellationFees * 100) / 100,
    refunded: Math.round(refunded * 100) / 100,
    // Net is what the business actually kept — revenue plus any
    // cancellation fee collected, minus what was refunded back out.
    // Reporting revenue alone when a chunk of it was refunded would
    // overstate what the business took.
    netRevenue: Math.round((revenue + cancellationFees - refunded) * 100) / 100,
    averageJobValue: completed.length ? Math.round((revenue / completed.length) * 100) / 100 : 0,
  };
}
