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
 * IMPORTANT — GST is ADDED here, not extracted.
 *
 * That is the opposite of client invoices, where prices in settings are
 * what the pet owner pays and GST is extracted from the inclusive total.
 * Business-to-business pricing is quoted ex-GST by convention: a partner
 * agreeing "$80 per collection" means $80 plus GST. Extracting instead
 * would quietly under-bill the partner by a eleventh on every invoice
 * and leave the business short at BAS time.
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

  const subtotal = cents(lines.reduce((sum, l) => sum + l.amount, 0));

  // No GST line at all when the business isn't registered. Showing "$0.00
  // GST" implies a registration that doesn't exist, which misstates a tax
  // position on a document a partner will file.
  const gst = isGstRegistered ? cents(subtotal * ((Number(gstPercent) || 10) / 100)) : 0;

  return {
    lines,
    subtotal,
    gst,
    total: cents(subtotal + gst),
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
