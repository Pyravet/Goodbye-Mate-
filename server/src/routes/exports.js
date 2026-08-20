import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logAction } from '../audit/log.js';

const router = Router();

/**
 * Escape a single CSV cell.
 *
 * Two things matter here beyond quoting:
 *
 * 1. CSV INJECTION. A cell beginning =, +, - or @ is executed as a
 *    formula by Excel and Sheets when the file is opened. Client names
 *    and notes are user-supplied and end up in these exports, so a
 *    booking note starting "=HYPERLINK(..." would run on the
 *    accountant's machine. Prefixing with an apostrophe neutralises it
 *    while still displaying the original text.
 *
 * 2. Numbers are NOT quoted, so spreadsheets treat them as numbers and
 *    the accountant can sum a column without reformatting it.
 */
function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);

  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toCsv(headers, rows) {
  const lines = [headers.map(cell).join(',')];
  for (const row of rows) lines.push(row.map(cell).join(','));
  // CRLF and a UTF-8 BOM: Excel on Windows misreads plain LF files and
  // mangles non-ASCII (pet names with accents) without the BOM.
  return '\uFEFF' + lines.join('\r\n');
}

function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

/**
 * Optional date range. Defaults to everything, because a missing filter
 * should give the accountant MORE than they asked for, not silently
 * less — a truncated export that looks complete is worse than a big one.
 */
function dateRange(req) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
  return { from, to };
}

/** Jobs — the operational and revenue picture. */
router.get('/jobs.csv', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { from, to } = dateRange(req);
  const params = [];
  const where = [];
  if (from) { params.push(from); where.push(`j.job_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`j.job_date <= $${params.length}`); }

  const { rows } = await query(
    `SELECT j.job_number, j.job_date, j.job_time, j.status, j.payment_status,
            j.refunded_amount, j.client_name, j.client_phone, j.client_email,
            j.suburb, j.postcode, j.state, j.pet_name, j.pet_type, j.pet_breed,
            j.service_type, j.time_category, j.extra_travel_fee,
            u.full_name AS vet_name,
            COALESCE(li.extras, 0) AS extras_total,
            COALESCE(li.discounts, 0) AS discounts_total,
            j.created_at
     FROM jobs j
     LEFT JOIN vets v ON v.id = j.assigned_vet_id
     LEFT JOIN users u ON u.id = v.user_id
     LEFT JOIN LATERAL (
       SELECT SUM(amount) FILTER (WHERE amount > 0) AS extras,
              SUM(amount) FILTER (WHERE amount < 0) AS discounts
       FROM job_line_items WHERE job_id = j.id
     ) li ON true
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY j.job_date DESC, j.job_time DESC`,
    params
  );

  const csv = toCsv(
    ['Job number', 'Date', 'Time', 'Status', 'Payment status', 'Refunded',
     'Client', 'Phone', 'Email', 'Suburb', 'Postcode', 'State',
     'Pet', 'Type', 'Breed', 'Service', 'Time category',
     'Travel fee', 'Extras', 'Discounts', 'Vet', 'Created'],
    rows.map((r) => [
      r.job_number, r.job_date, r.job_time, r.status, r.payment_status,
      Number(r.refunded_amount) || 0,
      r.client_name, r.client_phone, r.client_email,
      r.suburb, r.postcode, r.state,
      r.pet_name, r.pet_type, r.pet_breed,
      r.service_type, r.time_category,
      Number(r.extra_travel_fee) || 0,
      Number(r.extras_total) || 0,
      Number(r.discounts_total) || 0,
      r.vet_name,
      r.created_at ? new Date(r.created_at).toISOString() : '',
    ])
  );

  await logAction({ actorUserId: req.user.sub, action: 'export_jobs_csv', targetType: 'export', targetId: null, metadata: { from, to, rows: rows.length } });
  sendCsv(res, `goodbye-mate-jobs-${from || 'all'}-to-${to || 'now'}.csv`, csv);
}));

/**
 * Payments ledger — charges AND refunds.
 *
 * Refunds appear as negative amounts, so summing the Amount column gives
 * the true net position rather than gross takings.
 */
router.get('/payments.csv', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { from, to } = dateRange(req);
  const params = [];
  const where = [];
  if (from) { params.push(from); where.push(`p.created_at >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`p.created_at < ($${params.length}::date + INTERVAL '1 day')`); }

  const { rows } = await query(
    `SELECT p.created_at, j.job_number, j.client_name, p.amount, p.status,
            p.provider, p.provider_transaction_id, p.is_manual,
            p.response_message, u.full_name AS processed_by
     FROM payments p
     JOIN jobs j ON j.id = p.job_id
     LEFT JOIN users u ON u.id = p.processed_by_user_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.created_at DESC`,
    params
  );

  const csv = toCsv(
    ['Date', 'Job number', 'Client', 'Amount', 'Status', 'Provider',
     'Transaction ID', 'Manual', 'Message', 'Processed by'],
    rows.map((r) => [
      new Date(r.created_at).toISOString(),
      r.job_number, r.client_name,
      Number(r.amount),
      r.status, r.provider, r.provider_transaction_id,
      r.is_manual ? 'yes' : 'no',
      r.response_message, r.processed_by,
    ])
  );

  await logAction({ actorUserId: req.user.sub, action: 'export_payments_csv', targetType: 'export', targetId: null, metadata: { from, to, rows: rows.length } });
  sendCsv(res, `goodbye-mate-payments-${from || 'all'}-to-${to || 'now'}.csv`, csv);
}));

/** Vet payouts — approved and paid periods, for reconciling RCTIs. */
router.get('/payouts.csv', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { from, to } = dateRange(req);
  const params = [];
  const where = ["p.status <> 'draft'"];
  if (from) { params.push(from); where.push(`p.period_start >= $${params.length}`); }
  if (to) { params.push(to); where.push(`p.period_end <= $${params.length}`); }

  const { rows } = await query(
    `SELECT p.rcti_number, p.period_start, p.period_end, p.status,
            u.full_name AS vet_name, v.abn, v.is_gst_registered,
            p.subtotal, p.gst, p.total, p.paid_at, p.payment_reference,
            (SELECT COUNT(*) FROM vet_payout_period_items i WHERE i.period_id = p.id) AS line_count
     FROM vet_payout_periods p
     JOIN vets v ON v.id = p.vet_id
     JOIN users u ON u.id = v.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY p.period_start DESC, u.full_name`,
    params
  );

  const csv = toCsv(
    ['RCTI number', 'Period start', 'Period end', 'Status', 'Vet', 'ABN',
     'GST registered', 'Subtotal', 'GST', 'Total', 'Paid at', 'Payment reference', 'Lines'],
    rows.map((r) => [
      r.rcti_number, r.period_start, r.period_end, r.status,
      r.vet_name, r.abn, r.is_gst_registered ? 'yes' : 'no',
      Number(r.subtotal), Number(r.gst), Number(r.total),
      r.paid_at ? new Date(r.paid_at).toISOString() : '',
      r.payment_reference,
      Number(r.line_count),
    ])
  );

  await logAction({ actorUserId: req.user.sub, action: 'export_payouts_csv', targetType: 'export', targetId: null, metadata: { from, to, rows: rows.length } });
  sendCsv(res, `goodbye-mate-payouts-${from || 'all'}-to-${to || 'now'}.csv`, csv);
}));

export default router;
