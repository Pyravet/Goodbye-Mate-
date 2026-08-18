/**
 * Weekly payout period maths.
 *
 * Pure functions — no database, no HTTP — so they can be unit-tested
 * directly. Everything works on 'YYYY-MM-DD' strings rather than Date
 * objects, because JavaScript Date is timezone-sensitive and payout
 * weeks must line up with Australian calendar dates, not UTC. Using
 * Date here is how you get a Sunday job landing in the wrong week for
 * everyone west of Greenwich.
 */

/** Day-of-week numbers as used by Date.getUTCDay(). */
export const WEEKDAYS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Start of the payout week containing `dateStr`.
 *
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {number} [weekStartsOn=1] 0=Sunday … 6=Saturday. Defaults to
 *   Monday, and is admin-configurable via settings.
 * @returns {string} 'YYYY-MM-DD' for the first day of that week.
 */
export function periodStartFor(dateStr, weekStartsOn = 1) {
  // Parse as UTC midnight so no local-timezone shift can occur — we're
  // doing calendar arithmetic, not instant-in-time arithmetic.
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  // How many days back to the most recent `weekStartsOn`. The +7 %7
  // keeps it non-negative when the week start is later in the week than
  // the current day (e.g. today Monday, week starts Wednesday).
  const diff = (day - weekStartsOn + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/**
 * End of the payout week (inclusive) that begins at `startStr`.
 *
 * @param {string} startStr 'YYYY-MM-DD' — must be a period start.
 * @returns {string} 'YYYY-MM-DD' six days later.
 */
export function periodEndFor(startStr) {
  const d = new Date(`${startStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/**
 * Human label for a period, e.g. "18 Aug – 24 Aug 2026".
 *
 * @param {string} startStr 'YYYY-MM-DD'
 * @param {string} endStr 'YYYY-MM-DD'
 */
export function periodLabel(startStr, endStr) {
  const opts = { day: 'numeric', month: 'short' };
  const start = new Date(`${startStr}T00:00:00Z`).toLocaleDateString('en-AU', { ...opts, timeZone: 'UTC' });
  const end = new Date(`${endStr}T00:00:00Z`).toLocaleDateString('en-AU', { ...opts, timeZone: 'UTC' });
  const year = endStr.slice(0, 4);
  return `${start} – ${end} ${year}`;
}

/**
 * Format an allocated RCTI number.
 *
 * Zero-padded so numbers sort correctly as text and look consistent on
 * a tax document.
 *
 * @param {string} prefix e.g. 'RCTI-'
 * @param {number} n
 */
export function formatRctiNumber(prefix, n) {
  return `${prefix}${String(n).padStart(5, '0')}`;
}

/**
 * Split a GST-inclusive total into its ex-GST and GST components.
 *
 * Only vets registered for GST charge it; for everyone else the GST
 * component is zero and the total is simply the subtotal. Australian
 * GST is 1/11th of a GST-inclusive amount.
 *
 * @param {number} total GST-inclusive total in dollars.
 * @param {boolean} isGstRegistered
 * @returns {{subtotal: number, gst: number, total: number}}
 */
export function splitGst(total, isGstRegistered) {
  const rounded = Math.round(total * 100) / 100;
  if (!isGstRegistered) {
    return { subtotal: rounded, gst: 0, total: rounded };
  }
  const gst = Math.round((rounded / 11) * 100) / 100;
  return { subtotal: Math.round((rounded - gst) * 100) / 100, gst, total: rounded };
}
