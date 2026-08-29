import { Router } from 'express';
import { withPetCounts } from '../domain/jobPets.js';
import { z } from 'zod';
import { pool, query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logAction } from '../audit/log.js';
import { billBreakdown, payoutBreakdown } from '../domain/pricing.js';
import {
  periodStartFor,
  periodEndFor,
  formatRctiNumber,
  splitGst,
  WEEKDAYS,
} from '../domain/payoutPeriods.js';
import {
  generatePeriodRctiPdf,
  periodRctiFilename,
} from '../pdf/generatePeriodRcti.js';

const router = Router();

/**
 * Configured first day of the payout week (0=Sun … 6=Sat), default
 * Monday. Stored in pricing_settings so admin can change it. Changing it
 * only affects periods generated afterwards — already-created periods
 * keep their original boundaries, because regrouping would alter RCTIs
 * that have already been issued.
 */
async function getWeekStartsOn() {
  const { rows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const configured = rows[0]?.config?.payoutWeekStartDay;
  return Number.isInteger(configured) ? configured : WEEKDAYS.monday;
}

/**
 * GET /payouts/periods?weekStart=YYYY-MM-DD
 *
 * Admin payout run for a week: every vet with completed jobs in that
 * period, their computed total, and the saved period if one exists.
 *
 * Draft figures are computed LIVE from current job data. Once a period
 * is approved the stored figures are shown instead, because those are
 * frozen and must not drift.
 */
router.get('/periods', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const weekStartsOn = await getWeekStartsOn();
  const anchor = req.query.weekStart || new Date().toISOString().slice(0, 10);
  const periodStart = periodStartFor(anchor, weekStartsOn);
  const periodEnd = periodEndFor(periodStart);

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const pricing = pricingRows[0].config;

  // Completed jobs in the window, grouped by vet.
  const { rows: jobs } = await query(
    `SELECT j.*, u.full_name AS vet_name, v.is_gst_registered
     FROM jobs j
     JOIN vets v ON v.id = j.assigned_vet_id
     JOIN users u ON u.id = v.user_id
     WHERE j.status = 'completed'
       AND j.job_date BETWEEN $1 AND $2
     ORDER BY u.full_name, j.job_date`,
    [periodStart, periodEnd]
  );
  const jobsWithPets = await withPetCounts(jobs);

  const { rows: existing } = await query(
    'SELECT * FROM vet_payout_periods WHERE period_start = $1',
    [periodStart]
  );
  const savedByVet = new Map(existing.map((p) => [p.vet_id, p]));

  // One query for every job's line items rather than one PER job. The
  // payout run covers every vet's whole week, so a per-job query here is
  // an N+1 that grows with business volume — exactly the sort of thing
  // that's fine with two test jobs and slow with two hundred.
  const itemsByJob = new Map();
  if (jobs.length > 0) {
    const { rows: allItems } = await query(
      'SELECT job_id, label, amount, vet_payout FROM job_line_items WHERE job_id = ANY($1::uuid[])',
      [jobs.map((j) => j.id)]
    );
    for (const item of allItems) {
      if (!itemsByJob.has(item.job_id)) itemsByJob.set(item.job_id, []);
      itemsByJob.get(item.job_id).push(item);
    }
  }

  const byVet = new Map();
  for (const job of jobsWithPets) {
    if (!byVet.has(job.assigned_vet_id)) {
      byVet.set(job.assigned_vet_id, {
        vetId: job.assigned_vet_id,
        vetName: job.vet_name,
        isGstRegistered: job.is_gst_registered,
        jobs: [],
        computedTotal: 0,
      });
    }
    const entry = byVet.get(job.assigned_vet_id);
    const payout = payoutBreakdown(job, pricing, itemsByJob.get(job.id) || []);
    // A refunded job is NOT silently dropped from the payout: the vet
    // usually still attended and did the work, so whether they're paid
    // is a commercial decision, not something code should make quietly.
    // It's flagged instead, so admin can remove it deliberately before
    // approving.
    entry.jobs.push({
      id: job.id,
      jobNumber: job.job_number,
      jobDate: job.job_date,
      petName: job.pet_name,
      amount: payout.total,
      paymentStatus: job.payment_status,
      refundedAmount: Number(job.refunded_amount) || 0,
    });
    entry.computedTotal = Math.round((entry.computedTotal + payout.total) * 100) / 100;
  }

  const vets = [...byVet.values()].map((entry) => {
    const saved = savedByVet.get(entry.vetId) || null;
    return {
      ...entry,
      // Once frozen, show the stored figures — not a fresh calculation.
      total: saved && saved.status !== 'draft' ? Number(saved.total) : entry.computedTotal,
      period: saved
        ? {
            id: saved.id,
            status: saved.status,
            rctiNumber: saved.rcti_number,
            subtotal: Number(saved.subtotal),
            gst: Number(saved.gst),
            total: Number(saved.total),
            paidAt: saved.paid_at,
            paymentReference: saved.payment_reference,
          }
        : null,
    };
  });

  res.json({ periodStart, periodEnd, weekStartsOn, vets });
}));

const approveSchema = z.object({
  vetId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * POST /payouts/periods/approve
 *
 * Freeze a vet's week: snapshot every completed job's payout into
 * period items, allocate an RCTI number, and mark the period approved.
 *
 * Runs in a transaction with a row lock on the RCTI counter, so two
 * admins approving simultaneously cannot be issued the same number.
 */
router.post('/periods/approve', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'vetId and periodStart are required' });
  const { vetId, periodStart } = parsed.data;
  const periodEnd = periodEndFor(periodStart);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existingRows } = await client.query(
      'SELECT * FROM vet_payout_periods WHERE vet_id = $1 AND period_start = $2 FOR UPDATE',
      [vetId, periodStart]
    );
    if (existingRows[0] && existingRows[0].status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `This period is already ${existingRows[0].status}.` });
    }

    const { rows: vetRows } = await client.query(
      'SELECT v.*, u.full_name FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1',
      [vetId]
    );
    const vet = vetRows[0];
    if (!vet) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Vet not found' });
    }

    const { rows: pricingRows } = await client.query('SELECT config FROM pricing_settings WHERE id = true');
    const pricing = pricingRows[0].config;

    const { rows: jobs } = await client.query(
      `SELECT j.*, (
         -- Counted in the same query: this is the figure that gets
         -- FROZEN onto the RCTI, and an under-count here underpays the
         -- vet permanently since approved totals are never recomputed.
         SELECT count(*)::int FROM job_pets p WHERE p.job_id = j.id
       ) AS "petCount"
       FROM jobs j
       WHERE j.assigned_vet_id = $1 AND j.status = 'completed'
         AND j.job_date BETWEEN $2 AND $3
       ORDER BY j.job_date`,
      [vetId, periodStart, periodEnd]
    );
    if (jobs.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No completed jobs in this period to approve.' });
    }

    // Allocate the RCTI number under a row lock — this is what prevents
    // two concurrent approvals receiving the same number.
    const { rows: seqRows } = await client.query('SELECT * FROM rcti_sequence WHERE id = true FOR UPDATE');
    const seq = seqRows[0];
    const rctiNumber = formatRctiNumber(seq.prefix, seq.next_number);
    await client.query('UPDATE rcti_sequence SET next_number = next_number + 1 WHERE id = true');

    // Snapshot each job's payout as it stands right now.
    let runningTotal = 0;
    const itemRows = [];
    for (const job of jobs) {
      const { rows: lineItems } = await client.query(
        'SELECT label, amount, vet_payout FROM job_line_items WHERE job_id = $1',
        [job.id]
      );
      const payout = payoutBreakdown(job, pricing, lineItems);
      runningTotal += payout.total;
      // Base service + transfer + travel as one line, then EACH extra
      // as its own line. Previously the whole job collapsed into a
      // single line labelled with just the service name, so a vet paid
      // an extra-travel or large-pet fee could see the money in the
      // total but had no idea what it was for — and no way to check it
      // was right. A tax invoice should itemise what's being paid.
      const baseAmount = Math.round(
        (payout.serviceAmt + payout.transferAmt + payout.travelAmt) * 100
      ) / 100;

      itemRows.push({
        jobId: job.id,
        jobNumber: job.job_number,
        jobDate: job.job_date,
        petName: job.pet_name,
        description: payout.travelAmt > 0
          ? `${payout.serviceName} (incl. travel)`
          : payout.serviceName,
        amount: baseAmount,
      });

      for (const item of lineItems) {
        const vetShare = Number(item.vet_payout) || 0;
        if (vetShare === 0) continue; // client-only charge; not the vet's income
        itemRows.push({
          jobId: job.id,
          jobNumber: job.job_number,
          jobDate: job.job_date,
          petName: job.pet_name,
          description: item.label,
          amount: vetShare,
        });
      }
    }

    const { subtotal, gst, total } = splitGst(runningTotal, vet.is_gst_registered);

    const periodId = existingRows[0]?.id;
    let saved;
    if (periodId) {
      const { rows } = await client.query(
        `UPDATE vet_payout_periods
         SET status = 'approved', rcti_number = $1, subtotal = $2, gst = $3, total = $4,
             approved_at = now(), approved_by = $5
         WHERE id = $6 RETURNING *`,
        [rctiNumber, subtotal, gst, total, req.user.sub, periodId]
      );
      saved = rows[0];
      await client.query('DELETE FROM vet_payout_period_items WHERE period_id = $1', [periodId]);
    } else {
      const { rows } = await client.query(
        `INSERT INTO vet_payout_periods
           (vet_id, period_start, period_end, status, rcti_number, subtotal, gst, total, approved_at, approved_by)
         VALUES ($1,$2,$3,'approved',$4,$5,$6,$7, now(), $8)
         RETURNING *`,
        [vetId, periodStart, periodEnd, rctiNumber, subtotal, gst, total, req.user.sub]
      );
      saved = rows[0];
    }

    for (const item of itemRows) {
      await client.query(
        `INSERT INTO vet_payout_period_items
           (period_id, job_id, job_number, job_date, pet_name, description, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [saved.id, item.jobId, item.jobNumber, item.jobDate, item.petName, item.description, item.amount]
      );
    }

    await client.query('COMMIT');

    await logAction({
      actorUserId: req.user.sub,
      action: 'payout_period_approved',
      targetType: 'vet_payout_period',
      targetId: saved.id,
      metadata: { vetId, periodStart, rctiNumber, total },
    });

    res.json({ period: saved });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

const markPaidSchema = z.object({
  paymentReference: z.string().trim().max(200).optional().nullable(),
});

/** POST /payouts/periods/:id/mark-paid */
router.post('/periods/:id/mark-paid', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = markPaidSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payment reference' });

  const { rows } = await query(
    `UPDATE vet_payout_periods
     SET status = 'paid', paid_at = now(), payment_reference = $1
     WHERE id = $2 AND status = 'approved' RETURNING *`,
    [parsed.data.paymentReference || null, req.params.id]
  );
  if (!rows[0]) {
    return res.status(409).json({ error: 'Period not found, or not in an approved state.' });
  }

  await logAction({
    actorUserId: req.user.sub,
    action: 'payout_period_paid',
    targetType: 'vet_payout_period',
    targetId: req.params.id,
    metadata: { paymentReference: parsed.data.paymentReference },
  });

  res.json({ period: rows[0] });
}));

/**
 * GET /payouts/periods/:id/rcti.pdf
 *
 * Vets may download their own; admin may download any.
 */
router.get('/periods/:id/rcti.pdf', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, u.full_name, u.id AS user_id, v.abn, v.reg_number, v.reg_state, v.is_gst_registered
     FROM vet_payout_periods p
     JOIN vets v ON v.id = p.vet_id
     JOIN users u ON u.id = v.user_id
     WHERE p.id = $1`,
    [req.params.id]
  );
  const period = rows[0];
  if (!period) return res.status(404).json({ error: 'Period not found' });

  if (req.user.role !== 'admin' && req.user.sub !== period.user_id) {
    return res.status(403).json({ error: 'This RCTI belongs to another vet.' });
  }

  const { rows: items } = await query(
    'SELECT * FROM vet_payout_period_items WHERE period_id = $1 ORDER BY job_date, job_number',
    [req.params.id]
  );
  const { rows: contentRows } = await query('SELECT config FROM content_settings WHERE id = true');
  const company = contentRows[0].config.company || {};

  const vet = {
    full_name: period.full_name,
    abn: period.abn,
    reg_number: period.reg_number,
    reg_state: period.reg_state,
    is_gst_registered: period.is_gst_registered,
  };

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${periodRctiFilename(period, vet)}"`);
  generatePeriodRctiPdf({ res, period, items, vet, company });
}));

/**
 * GET /payouts/my-periods — a vet's own payout history.
 */
router.get('/my-periods', requireAuth, requireRole('vet'), asyncHandler(async (req, res) => {
  const { rows: vetRows } = await query('SELECT id FROM vets WHERE user_id = $1', [req.user.sub]);
  if (!vetRows[0]) return res.status(403).json({ error: 'Not a vet account' });

  const { rows } = await query(
    `SELECT id, period_start, period_end, status, rcti_number, subtotal, gst, total, paid_at, payment_reference
     FROM vet_payout_periods
     WHERE vet_id = $1 AND status <> 'draft'
     ORDER BY period_start DESC`,
    [vetRows[0].id]
  );
  res.json({ periods: rows });
}));

export default router;
