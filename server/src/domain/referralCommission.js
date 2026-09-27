/**
 * What a referral partner is owed for one completed, referred job.
 *
 * The base is the job's CLIENT TOTAL — the full invoiced amount — not
 * the vet's payout. A partner referred the family to the business, not
 * to a specific vet's earnings, so their commission is a share of what
 * the business actually billed.
 *
 * @param {number} jobTotal the client's total for this job (from billBreakdown)
 * @param {{commission_type: 'flat'|'percentage', commission_value: number}} partner
 * @returns {number} the commission owed, in dollars, rounded to cents
 */
export function calculateCommission(jobTotal, partner) {
  const value = Number(partner?.commission_value) || 0;
  if (value <= 0) return 0;

  const raw = partner?.commission_type === 'percentage'
    ? Number(jobTotal) * (value / 100)
    : value; // flat: the same amount regardless of job size

  // A flat commission can never exceed what the job actually billed —
  // a partner cannot be owed more than the client paid, even if
  // admin fat-fingers a flat rate larger than a particular job's total.
  const capped = Math.min(raw, Number(jobTotal) || 0);
  return Math.max(0, Math.round(capped * 100) / 100);
}

/**
 * A human-readable explanation of how a commission was worked out —
 * shown on the statement and stored alongside the frozen amount, so a
 * partner querying "why $36?" can be shown "8% of $450", not just the
 * final number with no working.
 */
export function describeCommission(jobTotal, partner) {
  if (partner?.commission_type === 'percentage') {
    return `${Number(partner.commission_value)}% of $${Number(jobTotal).toFixed(2)}`;
  }
  return `Flat rate ($${Number(partner?.commission_value || 0).toFixed(2)})`;
}
