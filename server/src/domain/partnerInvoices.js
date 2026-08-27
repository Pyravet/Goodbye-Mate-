import { extractGst } from './pricing.js';

/**
 * Partner invoice totals.
 *
 * Pure and DB-free so the arithmetic is testable directly, and so the
 * admin UI can preview exactly what will be stored rather than
 * duplicating the rule.
 */

/** Round to whole cents. Money must never carry a fraction of a cent. */
function cents(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * A single line's amount.
 * @param {number} quantity
 * @param {number} unitAmount
 */
export function lineAmount(quantity, unitAmount) {
  return cents((Number(quantity) || 0) * (Number(unitAmount) || 0));
}

/**
 * Invoice totals.
 *
 * PRICES ARE GST-INCLUSIVE. An amount entered as $80 is what the partner
 * pays; the GST is the eleventh already inside it, not something added
 * on top. This matches client invoices and the rest of the pricing in
 * this system, so a figure means the same thing everywhere.
 *
 * The `total` is therefore always the sum of the line amounts, whether
 * or not the business is GST registered. Registration only changes
 * whether the tax component is DISCLOSED — it never changes what is
 * charged.
 *
 * @param {Array<{quantity:number, unitAmount:number}>} items
 * @param {object} opts
 * @param {boolean} opts.isGstRegistered
 * @param {number} opts.gstPercent
 */
export function invoiceTotals(items, { isGstRegistered, gstPercent = 10 } = {}) {
  const lines = (items || []).map((i) => ({
    ...i,
    amount: lineAmount(i.quantity, i.unitAmount),
  }));

  // What the partner pays, taken straight from the lines.
  const total = cents(lines.reduce((sum, l) => sum + l.amount, 0));

  // Extracted from the inclusive total using the shared helper rather
  // than a second implementation — a duplicate rounding rule is how two
  // documents end up disagreeing by a cent.
  //
  // Nothing is shown at all when the business isn't registered: a
  // "$0.00 GST" line implies a registration that doesn't exist, on a
  // document the partner will file with their own accounts.
  const { gstAmount } = isGstRegistered
    ? extractGst(total, Number(gstPercent) || 10)
    : { gstAmount: 0 };

  return {
    lines,
    // Subtotal is the ex-GST figure when registered, and simply the
    // total when not — so subtotal + gst always equals total.
    subtotal: cents(total - gstAmount),
    gst: gstAmount,
    total,
    isGstRegistered: !!isGstRegistered,
  };
}

/**
 * Format an invoice number from a counter.
 * Prefixed so it can never be mistaken for a job number or an RCTI.
 */
export function formatInvoiceNumber(n) {
  return `INV-${String(n).padStart(5, '0')}`;
}

/**
 * Default due date: issue date plus the agreed terms.
 * @param {string} issueDate 'YYYY-MM-DD'
 * @param {number} days
 */
export function dueDateFor(issueDate, days = 14) {
  const d = new Date(`${String(issueDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}
