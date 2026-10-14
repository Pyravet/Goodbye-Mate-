import { query } from '../db/pool.js';

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * What a client has paid and still owes, from a bill total and the
 * ledger of payment rows (charges are positive, refunds negative).
 * Pure — the DB lookup lives in getPaymentPosition.
 *
 * `due` is never negative: an overpayment (a discount added after the
 * client paid) is `credit`, which goes back through the Refund flow
 * rather than being silently absorbed.
 */
export function paymentPosition(total, netPaid) {
  const t = round2(total);
  const paid = Math.max(0, round2(netPaid));
  return {
    total: t,
    paid,
    due: Math.max(0, round2(t - paid)),
    credit: Math.max(0, round2(paid - t)),
  };
}

/** Net money received for a job: successful charges less refunds. */
export async function getNetPaid(jobId) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(amount), 0) AS net FROM payments
     WHERE job_id = $1 AND status IN ('succeeded', 'refunded')`,
    [jobId]
  );
  return Number(rows[0].net) || 0;
}

export async function getPaymentPosition(jobId, total) {
  return paymentPosition(total, await getNetPaid(jobId));
}
