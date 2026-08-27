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
 * GST treatment is chosen PER INVOICE, because it genuinely differs:
 * some partners are billed inclusive, others agree ex-GST rates, and a
 * GST-free recipient carries none at all. Two invoices issued the same
 * day can legitimately need different treatment.
 *
 *   'inclusive' — entered amounts are what the partner PAYS. GST is the
 *                 eleventh already inside, disclosed separately.
 *   'exclusive' — entered amounts are ex-GST. GST is ADDED on top, so
 *                 the partner pays more than the figures typed.
 *   'none'      — no GST line at all. Not the same as zero: a "$0.00
 *                 GST" line implies a registration that may not exist,
 *                 on a document the partner files with their accounts.
 *
 * @param {Array<{quantity:number, unitAmount:number}>} items
 * @param {object} opts
 * @param {'inclusive'|'exclusive'|'none'} opts.gstMode
 * @param {number} opts.gstPercent
 */
export function invoiceTotals(items, { gstMode = 'inclusive', gstPercent = 10 } = {}) {
  const lines = (items || []).map((i) => ({
    ...i,
    amount: lineAmount(i.quantity, i.unitAmount),
  }));

  const entered = cents(lines.reduce((sum, l) => sum + l.amount, 0));
  const rate = Number(gstPercent);
  const pct = Number.isFinite(rate) && rate >= 0 ? rate : 10;

  if (gstMode === 'none' || pct === 0) {
    return { lines, subtotal: entered, gst: 0, total: entered, gstMode: 'none', gstPercent: pct };
  }

  if (gstMode === 'exclusive') {
    // Added on top — the partner pays MORE than the figures entered.
    const gst = cents(entered * (pct / 100));
    return {
      lines,
      subtotal: entered,
      gst,
      // Derived from subtotal + gst so the three always reconcile, even
      // when the multiplication rounds.
      total: cents(entered + gst),
      gstMode: 'exclusive',
      gstPercent: pct,
    };
  }

  // Inclusive. Extracted with the shared helper rather than a second
  // implementation — a duplicate rounding rule is how two documents end
  // up disagreeing by a cent.
  const { gstAmount } = extractGst(entered, pct);
  return {
    lines,
    subtotal: cents(entered - gstAmount),
    gst: gstAmount,
    // Unchanged by the split: what the partner owes must not move
    // because the tax extraction rounded.
    total: entered,
    gstMode: 'inclusive',
    gstPercent: pct,
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
