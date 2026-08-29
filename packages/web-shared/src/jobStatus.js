/**
 * What a job's status looks like at a glance.
 *
 * One place, shared by the admin board and the vet list, so the two
 * can't disagree about what "done" means. Two screens each deciding
 * independently is how a job reads as complete on one and outstanding
 * on the other.
 *
 * Colours carry meaning:
 *   brick  (red)   — needs attention: unpaid, unsigned, or overdue
 *   honey  (amber) — in progress, nothing wrong
 *   forest (green) — finished, nothing owed
 *
 * Colour is never the ONLY signal — every badge carries a word too.
 * Roughly one man in twelve can't reliably separate red from green, and
 * these screens are read on a phone in daylight.
 */

const CANCELLED = new Set(['cancelled']);

/** YYYY-MM-DD, tolerating the Date objects node-postgres returns. */
function dateKey(value) {
  if (!value) return '';
  return value instanceof Date
    ? value.toLocaleDateString('en-CA')
    : String(value).slice(0, 10);
}

/**
 * The badges a job should show, most urgent first.
 *
 * @param {object} job
 * @param {object} [opts]
 * @param {boolean} [opts.showMoney] whether payment state is the
 *   viewer's business — vets see whether it's paid, because arriving to
 *   an unpaid visit means raising money at the door.
 * @returns {Array<{label: string, tone: 'brick'|'honey'|'forest'}>}
 */
export function jobStatusBadges(job, { showMoney = true } = {}) {
  if (!job) return [];
  const badges = [];

  if (CANCELLED.has(job.status)) {
    return [{ label: 'Cancelled', tone: 'brick' }];
  }

  if (job.status === 'completed') {
    badges.push({ label: 'Completed', tone: 'forest' });
    // A completed job that was never paid is the easiest money to lose:
    // the work is done, the vet has moved on, and nothing else will
    // surface it.
    if (showMoney && job.payment_status !== 'paid') {
      badges.push({ label: 'UNPAID', tone: 'brick' });
    }
    return badges;
  }

  // Past its date and still not finished. Shown before anything else,
  // because it's the one state nobody is otherwise chasing.
  const today = new Date().toLocaleDateString('en-CA');
  if (job.job_date && dateKey(job.job_date) < today) {
    badges.push({ label: 'Overdue', tone: 'brick' });
  }

  if (job.status === 'in_route') badges.push({ label: 'On the way', tone: 'honey' });
  else if (job.status === 'started') badges.push({ label: 'In progress', tone: 'honey' });

  // Readiness. Both block the visit going ahead properly, so both are
  // red rather than amber — an unsigned consent an hour before a visit
  // is a problem, not a note.
  if (!job.consent_signed) badges.push({ label: 'No consent', tone: 'brick' });
  if (showMoney && job.payment_status !== 'paid') {
    badges.push({ label: 'Unpaid', tone: 'brick' });
  }

  // Nothing outstanding and not yet started: say so positively rather
  // than leaving a blank row that could mean anything.
  if (badges.length === 0) badges.push({ label: 'Ready', tone: 'forest' });

  return badges;
}

/**
 * A single colour for the whole job, for a dot or a card edge.
 * Worst state wins: red beats amber beats green.
 */
export function jobStatusTone(job, opts) {
  const badges = jobStatusBadges(job, opts);
  if (badges.some((b) => b.tone === 'brick')) return 'brick';
  if (badges.some((b) => b.tone === 'honey')) return 'honey';
  return 'forest';
}
