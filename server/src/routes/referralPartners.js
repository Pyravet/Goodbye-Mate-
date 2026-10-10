import { Router } from 'express';
import { z } from 'zod';
import { pool, query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logAction } from '../audit/log.js';
import { notifyAdmins } from '../notifications/notify.js';
import { noticePartner } from '../notifications/jobNotices.js';
import { withPetCount } from '../domain/jobPets.js';
import { sendSlackMessage } from '../integrations/slack/webhook.js';
import { encrypt, decrypt, isEncryptionConfigured, maskTail } from '../security/encryption.js';
import { billBreakdown } from '../domain/pricing.js';
import { calculateCommission, describeCommission } from '../domain/referralCommission.js';
import { generateReferralStatementPdfBuffer } from '../pdf/generateReferralStatement.js';

/**
 * A job's ad-hoc extras and discounts, for pricing the client bill this
 * commission is based on. A local copy rather than importing the
 * private helper of the same name in routes/jobs.js — reaching into
 * another route file's unexported internals is exactly the kind of
 * coupling that breaks silently when that file is refactored.
 */
async function getLineItems(jobId) {
  const { rows } = await query(
    'SELECT label, amount, vet_payout FROM job_line_items WHERE job_id = $1 ORDER BY created_at',
    [jobId]
  );
  return rows;
}

const router = Router();

/** Sunday-to-Saturday, matching the vet payout period convention. */
function periodEndFor(periodStart) {
  const d = new Date(`${periodStart}T00:00:00`);
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

function formatStatementNumber(prefix, n) {
  return `${prefix}${String(n).padStart(5, '0')}`;
}

/**
 * The partner this user belongs to.
 *
 * EVERY partner-facing query is scoped through this. A partner seeing
 * another partner's referrals would expose a competitor's client list —
 * so the partner id comes from the SESSION, never from the request body
 * or a query parameter, which is the only way it can't be tampered with.
 */
async function partnerIdForUser(userId) {
  const { rows } = await query(
    'SELECT referral_partner_id FROM referral_partner_users WHERE user_id = $1', [userId]
  );
  return rows[0]?.referral_partner_id || null;
}

// ============================================================
// PARTNER-FACING — a referral partner's own login, scoped to itself
// ============================================================

router.get('/me', requireAuth, requireRole('referral_partner'), asyncHandler(async (req, res) => {
  const partnerId = await partnerIdForUser(req.user.sub);
  if (!partnerId) return res.status(403).json({ error: 'This login is not linked to a referral partner.' });

  const { rows } = await query('SELECT * FROM referral_partners WHERE id = $1', [partnerId]);
  if (!rows[0]?.is_active) {
    return res.status(403).json({ error: 'This account is not active. Please contact us.' });
  }
  // Commission rate and payout figures are the partner's own business,
  // shown to them; bank details are not returned here at all — only
  // admin ever needs to see (masked) what was entered.
  const { bank_account_name_enc, bank_bsb_enc, bank_account_number_enc, ...safe } = rows[0];
  res.json({ partner: safe });
}));

const referralSchema = z.object({
  clientName: z.string().trim().min(1, 'The client needs a name.'),
  clientPhone: z.string().trim().min(6, 'A contact number is needed.'),
  clientEmail: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().email('That email address is not valid.').nullable().optional()
  ),
  petName: z.string().trim().min(1, 'The pet needs a name.'),
  petType: z.string().trim().optional().nullable(),
  petBreed: z.string().trim().optional().nullable(),
  suburb: z.string().trim().optional().nullable(),
  postcode: z.string().trim().optional().nullable(),
  servicePreference: z.string().trim().optional().nullable(),
  preferredTiming: z.string().trim().optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),
});

/**
 * POST /referral-partners/referrals — refer a client.
 *
 * Creates a booking_request, the same object the public form creates, so
 * it lands in the admin inbox admin already works from and the existing
 * convert-to-job flow applies unchanged. The only difference is the
 * partner attribution.
 */
router.post('/referrals', requireAuth, requireRole('referral_partner'), asyncHandler(async (req, res) => {
  const partnerId = await partnerIdForUser(req.user.sub);
  if (!partnerId) return res.status(403).json({ error: 'This login is not linked to a referral partner.' });

  const parsed = referralSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid referral' });
  }
  const d = parsed.data;

  const { rows: partnerRows } = await query('SELECT name, is_active FROM referral_partners WHERE id = $1', [partnerId]);
  if (!partnerRows[0]?.is_active) {
    return res.status(403).json({ error: 'This account is not active.' });
  }

  const { rows } = await query(
    `INSERT INTO booking_requests
       (client_name, client_phone, client_email, pet_name, pet_type, pet_breed,
        suburb, postcode, service_preference, preferred_timing, message,
        referred_by_partner_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'new')
     RETURNING id, created_at`,
    [
      d.clientName, d.clientPhone, d.clientEmail || null, d.petName,
      d.petType || null, d.petBreed || null, d.suburb || null, d.postcode || null,
      d.servicePreference || null, d.preferredTiming || null, d.message || null,
      partnerId,
    ]
  );

  // A referral is more urgent than a web enquiry: someone has a family
  // in front of them expecting a call back, and their own reputation is
  // attached to how quickly that happens.
  notifyAdmins({
    title: 'Referral received',
    body: `${partnerRows[0].name} referred ${d.clientName} for ${d.petName}. `
      + `${d.preferredTiming ? `Timing: ${d.preferredTiming}.` : ''}`,
    url: '/requests',
    category: 'job',
  }).catch((e) => console.error('referral notify failed:', e.message));

  sendSlackMessage(
    `🤝 *Referral from ${partnerRows[0].name}* — ${d.clientName} / ${d.petName}`
    + `${d.preferredTiming ? ` · ${d.preferredTiming}` : ''}`
  ).catch((e) => console.error('referral slack failed:', e.message));

  await logAction({
    actorUserId: req.user.sub, action: 'partner_referral_created',
    targetType: 'booking_request', targetId: rows[0].id, metadata: { partnerId },
  });

  res.status(201).json({ referral: rows[0] });
}));

/**
 * GET /referral-partners/referrals — the partner's own referrals and
 * what became of them.
 *
 * DELIBERATELY LIMITED FIELDS. The partner sees the outcome of a
 * referral they made, not the job record: no address, no pricing, no
 * vet details, no clinical notes, and no commission figures here either
 * — those live under /my-payouts, kept separate so a referral list
 * doesn't double as a running income statement.
 */
router.get('/referrals', requireAuth, requireRole('referral_partner'), asyncHandler(async (req, res) => {
  const partnerId = await partnerIdForUser(req.user.sub);
  if (!partnerId) return res.status(403).json({ error: 'This login is not linked to a referral partner.' });

  const { rows } = await query(
    `SELECT r.id, r.client_name, r.pet_name, r.pet_type, r.created_at, r.status,
            r.preferred_timing,
            j.job_number, j.job_date, j.status AS job_status
     FROM booking_requests r
     LEFT JOIN jobs j ON j.id = r.converted_job_id
     WHERE r.referred_by_partner_id = $1
     ORDER BY r.created_at DESC
     LIMIT 200`,
    [partnerId]
  );

  const { rows: stats } = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE converted_job_id IS NOT NULL)::int AS converted,
            COUNT(*) FILTER (WHERE status = 'new')::int AS awaiting_contact
     FROM booking_requests WHERE referred_by_partner_id = $1`,
    [partnerId]
  );

  res.json({ referrals: rows, stats: stats[0] });
}));

/**
 * GET /referral-partners/my-payouts — the partner's own payout history.
 * Same limited-fields philosophy: totals and status, not the itemised
 * job list behind them — that detail is on the PDF statement.
 */
router.get('/my-payouts', requireAuth, requireRole('referral_partner'), asyncHandler(async (req, res) => {
  const partnerId = await partnerIdForUser(req.user.sub);
  if (!partnerId) return res.status(403).json({ error: 'This login is not linked to a referral partner.' });

  const { rows } = await query(
    `SELECT id, period_start, period_end, status, statement_number, total, paid_at
     FROM referral_partner_payout_periods
     WHERE referral_partner_id = $1 AND status != 'draft'
     ORDER BY period_start DESC`,
    [partnerId]
  );
  res.json({ periods: rows });
}));

// ============================================================
// ADMIN-FACING — managing partners and their logins
// ============================================================

router.get('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT p.*,
            (SELECT COUNT(*)::int FROM booking_requests r WHERE r.referred_by_partner_id = p.id) AS referral_count,
            (SELECT COUNT(*)::int FROM jobs j WHERE j.referred_by_partner_id = p.id) AS job_count,
            (SELECT COUNT(*)::int FROM referral_partner_users u WHERE u.referral_partner_id = p.id) AS user_count,
            (SELECT COALESCE(SUM(total), 0) FROM referral_partner_payout_periods pp
             WHERE pp.referral_partner_id = p.id AND pp.status IN ('approved','paid')) AS total_paid_or_owed
     FROM referral_partners p ORDER BY p.is_active DESC, p.name`
  );
  // Bank details never travel in the list view — only on the single-
  // partner GET below, and even then masked.
  res.json({
    partners: rows.map(({ bank_account_name_enc, bank_bsb_enc, bank_account_number_enc, ...p }) => p),
  });
}));

router.get('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM referral_partners WHERE id = $1', [req.params.id]);
  const partner = rows[0];
  if (!partner) return res.status(404).json({ error: 'Referral partner not found' });

  let bankDetails = { hasBankDetails: !!partner.bank_account_number_enc };
  if (partner.bank_account_number_enc) {
    try {
      bankDetails = {
        hasBankDetails: true,
        accountName: decrypt(partner.bank_account_name_enc),
        bsb: partner.bank_bsb_enc ? maskTail(decrypt(partner.bank_bsb_enc), 2) : null,
        accountNumber: maskTail(decrypt(partner.bank_account_number_enc)),
      };
    } catch {
      bankDetails = { hasBankDetails: true, error: 'Could not decrypt' };
    }
  }
  const { bank_account_name_enc, bank_bsb_enc, bank_account_number_enc, ...safe } = partner;
  res.json({ partner: safe, bankDetails });
}));

const partnerSchema = z.object({
  name: z.string().trim().min(1, 'The partner needs a name.'),
  type: z.enum(['clinic', 'funeral_home', 'pet_store', 'other']).optional(),
  phone: z.string().trim().optional().nullable(),
  email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().email('That email address is not valid.').nullable().optional()
  ),
  address: z.string().trim().optional().nullable(),
  suburb: z.string().trim().optional().nullable(),
  postcode: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  abn: z.string().trim().optional().nullable(),
  isGstRegistered: z.boolean().optional(),
  commissionType: z.enum(['flat', 'percentage']).optional(),
  commissionValue: z.number().min(0).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

router.post('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = partnerSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid partner' });
  }
  const d = parsed.data;
  const { rows } = await query(
    `INSERT INTO referral_partners
       (name, type, phone, email, address, suburb, postcode, state, abn,
        is_gst_registered, commission_type, commission_value, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [d.name, d.type || 'other', d.phone || null, d.email || null, d.address || null,
     d.suburb || null, d.postcode || null, d.state || null, d.abn || null,
     d.isGstRegistered || false, d.commissionType || 'flat', d.commissionValue ?? 0, d.notes || null]
  );
  await logAction({
    actorUserId: req.user.sub, action: 'referral_partner_created',
    targetType: 'referral_partner', targetId: rows[0].id, metadata: { name: d.name },
  });
  const { bank_account_name_enc, bank_bsb_enc, bank_account_number_enc, ...safe } = rows[0];
  res.status(201).json({ partner: safe });
}));

router.put('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = partnerSchema.partial().safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid partner' });
  }
  const d = parsed.data;
  const { rows } = await query(
    `UPDATE referral_partners SET
       name = COALESCE($1, name), type = COALESCE($2, type),
       phone = COALESCE($3, phone), email = COALESCE($4, email),
       address = COALESCE($5, address), suburb = COALESCE($6, suburb),
       postcode = COALESCE($7, postcode), state = COALESCE($8, state), abn = COALESCE($9, abn),
       is_gst_registered = COALESCE($10, is_gst_registered),
       commission_type = COALESCE($11, commission_type),
       commission_value = COALESCE($12, commission_value),
       notes = COALESCE($13, notes), updated_at = now()
     WHERE id = $14 RETURNING *`,
    [d.name, d.type, d.phone, d.email, d.address, d.suburb, d.postcode, d.state, d.abn,
     d.isGstRegistered, d.commissionType, d.commissionValue, d.notes, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Referral partner not found' });
  await logAction({
    actorUserId: req.user.sub, action: 'referral_partner_updated',
    targetType: 'referral_partner', targetId: req.params.id, metadata: d,
  });
  const { bank_account_name_enc, bank_bsb_enc, bank_account_number_enc, ...safe } = rows[0];
  res.json({ partner: safe });
}));

/**
 * PUT /referral-partners/:id/bank-details
 *
 * Split from the general update above — the same separation vets.js
 * uses — so a plain profile edit can never accidentally touch payout
 * details, and the audit log entry for a bank-detail change is its own
 * distinct action rather than buried in a generic "partner_updated".
 */
const bankDetailsSchema = z.object({
  bankAccountName: z.string().trim().min(1).optional(),
  bankBsb: z.string().trim().min(1).optional(),
  bankAccountNumber: z.string().trim().min(1).optional(),
});

router.put('/:id/bank-details', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = bankDetailsSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid bank details' });
  const d = parsed.data;

  if (!isEncryptionConfigured()) {
    return res.status(503).json({ error: 'Bank detail storage is not configured yet.' });
  }

  const { rows } = await query(
    `UPDATE referral_partners SET
       bank_account_name_enc = COALESCE($1, bank_account_name_enc),
       bank_bsb_enc = COALESCE($2, bank_bsb_enc),
       bank_account_number_enc = COALESCE($3, bank_account_number_enc),
       updated_at = now()
     WHERE id = $4 RETURNING id`,
    [
      d.bankAccountName ? encrypt(d.bankAccountName) : null,
      d.bankBsb ? encrypt(d.bankBsb) : null,
      d.bankAccountNumber ? encrypt(d.bankAccountNumber) : null,
      req.params.id,
    ]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Referral partner not found' });

  await logAction({
    actorUserId: req.user.sub, action: 'referral_partner_bank_details_updated',
    targetType: 'referral_partner', targetId: req.params.id,
  });
  res.json({ ok: true });
}));

/**
 * Deactivate rather than delete. A partner that stops referring still
 * has referrals and paid statements attributed to it, and those records
 * must keep the attribution that explains where the money came from.
 */
router.post('/:id/set-active', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const isActive = req.body?.isActive === true;
  const { rows } = await query(
    'UPDATE referral_partners SET is_active=$1, updated_at=now() WHERE id=$2 RETURNING *',
    [isActive, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Referral partner not found' });
  await logAction({
    actorUserId: req.user.sub, action: isActive ? 'referral_partner_activated' : 'referral_partner_deactivated',
    targetType: 'referral_partner', targetId: req.params.id,
  });
  const { bank_account_name_enc, bank_bsb_enc, bank_account_number_enc, ...safe } = rows[0];
  res.json({ partner: safe });
}));

/**
 * Create a login for a partner. Same reasoning as clinics before it:
 * admin sets the initial password and hands it over directly rather
 * than emailing it, since email delivery isn't proven and a login that
 * silently never arrives is worse than one given on the phone.
 */
const partnerUserSchema = z.object({
  fullName: z.string().trim().min(1, 'A name is needed.'),
  email: z.string().trim().email('That email address is not valid.'),
  password: z.string().min(10, 'Use at least 10 characters.'),
});

router.post('/:id/users', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = partnerUserSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid login' });
  }
  const d = parsed.data;

  const { rows: partnerRows } = await query('SELECT id FROM referral_partners WHERE id = $1', [req.params.id]);
  if (!partnerRows[0]) return res.status(404).json({ error: 'Referral partner not found' });

  const { rows: existing } = await query(
    'SELECT id FROM users WHERE lower(email) = lower($1)', [d.email]
  );
  if (existing[0]) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const bcrypt = (await import('bcryptjs')).default;
  const { rows } = await query(
    `INSERT INTO users (email, full_name, password_hash, role, is_active)
     VALUES ($1,$2,$3,'referral_partner',true) RETURNING id, email, full_name`,
    [d.email.toLowerCase(), d.fullName, await bcrypt.hash(d.password, 10)]
  );
  await query('INSERT INTO referral_partner_users (user_id, referral_partner_id) VALUES ($1,$2)',
    [rows[0].id, req.params.id]);

  await logAction({
    actorUserId: req.user.sub, action: 'referral_partner_user_created',
    targetType: 'referral_partner', targetId: req.params.id, metadata: { email: d.email },
  });

  res.status(201).json({ user: rows[0] });
}));

router.get('/:id/users', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.email, u.full_name, u.is_active
     FROM referral_partner_users pu JOIN users u ON u.id = pu.user_id
     WHERE pu.referral_partner_id = $1 ORDER BY u.full_name`,
    [req.params.id]
  );
  res.json({ users: rows });
}));

// ============================================================
// PAYOUTS — mirrors the vet payout period pattern in routes/payouts.js
// ============================================================

router.get('/:id/payout-periods', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM referral_partner_payout_periods
     WHERE referral_partner_id = $1 ORDER BY period_start DESC`,
    [req.params.id]
  );
  res.json({ periods: rows });
}));

const approveSchema = z.object({
  partnerId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'periodStart must be YYYY-MM-DD'),
});

/**
 * POST /referral-partners/payout-periods/approve
 *
 * Same structure as POST /payouts/periods/approve for vets: freezes a
 * period's commission at approval time under a transaction and a row
 * lock, so pricing or commission-rate changes afterwards cannot alter an
 * already-issued statement, and two concurrent approvals cannot collide
 * on the same statement number.
 *
 * ELIGIBILITY IS THE JOB'S OWN STATUS. A job only enters this query once
 * it is status = 'completed' — nothing is written when a job completes,
 * nothing needs to be: completion is what makes it selectable here, the
 * same way an incomplete vet job never appears in a vet payout period.
 */
router.post('/payout-periods/approve', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'partnerId and periodStart are required' });
  const { partnerId, periodStart } = parsed.data;
  const periodEnd = periodEndFor(periodStart);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existingRows } = await client.query(
      'SELECT * FROM referral_partner_payout_periods WHERE referral_partner_id = $1 AND period_start = $2 FOR UPDATE',
      [partnerId, periodStart]
    );
    if (existingRows[0] && existingRows[0].status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `This period is already ${existingRows[0].status}.` });
    }

    const { rows: partnerRows } = await client.query('SELECT * FROM referral_partners WHERE id = $1', [partnerId]);
    const partner = partnerRows[0];
    if (!partner) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Referral partner not found' });
    }

    const { rows: pricingRows } = await client.query('SELECT config FROM pricing_settings WHERE id = true');
    const pricing = pricingRows[0].config;

    const { rows: jobs } = await client.query(
      `SELECT j.* FROM jobs j
       WHERE j.referred_by_partner_id = $1 AND j.status = 'completed'
         AND j.job_date BETWEEN $2 AND $3
       ORDER BY j.job_date`,
      [partnerId, periodStart, periodEnd]
    );
    if (jobs.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No completed referred jobs in this period to approve.' });
    }

    // Allocate the statement number under a row lock — this is what
    // prevents two concurrent approvals receiving the same number.
    const { rows: seqRows } = await client.query('SELECT * FROM referral_statement_sequence WHERE id = true FOR UPDATE');
    const seq = seqRows[0];
    const statementNumber = formatStatementNumber(seq.prefix, seq.next_number);
    await client.query('UPDATE referral_statement_sequence SET next_number = next_number + 1 WHERE id = true');

    let runningTotal = 0;
    const itemRows = [];
    const skippedRefunded = [];
    for (const job of jobs) {
      // Commission is a share of money the business KEPT. A fully
      // refunded job earns nothing; a partial refund reduces the base.
      if (job.payment_status === 'refunded') { skippedRefunded.push(job.job_number); continue; }
      const lineItems = await getLineItems(job.id);
      // withPetCount: the bill depends on how many animals — without it a
      // multi-pet job was billed as one pet and the commission came out
      // far too low.
      const fullBill = billBreakdown(await withPetCount(job), pricing, lineItems);
      const refunded = Number(job.refunded_amount) || 0;
      const bill = { total: Math.max(0, Math.round((fullBill.total - refunded) * 100) / 100) };
      const commission = calculateCommission(bill.total, partner);
      runningTotal += commission;

      itemRows.push({
        jobId: job.id,
        jobNumber: job.job_number,
        jobDate: job.job_date,
        clientName: job.client_name,
        jobTotal: bill.total,
        commissionType: partner.commission_type,
        commissionValue: partner.commission_value,
        amount: commission,
      });
    }

    // GST breakdown only shown if the PARTNER is GST-registered — same
    // treatment as a vet RCTI, and for the same reason: showing a GST
    // component on a statement to someone not registered for it
    // misstates a tax position.
    const rate = Number(pricing?.gstPercent) || 10;
    if (itemRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Every completed referred job in this period was fully refunded (${skippedRefunded.join(', ')}), so no commission is due.` });
    }

    let subtotal = runningTotal;
    let gst = 0;
    if (partner.is_gst_registered) {
      gst = Math.round((runningTotal * (rate / (100 + rate))) * 100) / 100;
      subtotal = Math.round((runningTotal - gst) * 100) / 100;
    }
    const total = Math.round(runningTotal * 100) / 100;

    const periodId = existingRows[0]?.id;
    let saved;
    if (periodId) {
      const { rows } = await client.query(
        `UPDATE referral_partner_payout_periods
         SET status = 'approved', statement_number = $1, subtotal = $2, gst = $3, total = $4,
             approved_at = now(), approved_by = $5
         WHERE id = $6 RETURNING *`,
        [statementNumber, subtotal, gst, total, req.user.sub, periodId]
      );
      saved = rows[0];
      await client.query('DELETE FROM referral_partner_payout_items WHERE period_id = $1', [periodId]);
    } else {
      const { rows } = await client.query(
        `INSERT INTO referral_partner_payout_periods
           (referral_partner_id, period_start, period_end, status, statement_number, subtotal, gst, total, approved_at, approved_by)
         VALUES ($1,$2,$3,'approved',$4,$5,$6,$7, now(), $8)
         RETURNING *`,
        [partnerId, periodStart, periodEnd, statementNumber, subtotal, gst, total, req.user.sub]
      );
      saved = rows[0];
    }

    for (const item of itemRows) {
      await client.query(
        `INSERT INTO referral_partner_payout_items
           (period_id, job_id, job_number, job_date, client_name, job_total,
            commission_type, commission_value, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [saved.id, item.jobId, item.jobNumber, item.jobDate, item.clientName, item.jobTotal,
         item.commissionType, item.commissionValue, item.amount]
      );
    }

    await client.query('COMMIT');

    await logAction({
      actorUserId: req.user.sub,
      action: 'referral_payout_period_approved',
      targetType: 'referral_partner_payout_period',
      targetId: saved.id,
      metadata: { partnerId, periodStart, statementNumber, total },
    });

    noticePartner(partnerId, {
      title: 'Commission statement ready',
      subject: `Commission statement ${saved.statement_number}`,
      message: `your commission statement ${saved.statement_number} for $${Number(saved.total).toFixed(2)} (${periodStart} to ${periodEnd}) is ready. You can view and download it in your portal. Payment will follow.`,
    }).catch((e) => console.error('partner statement notice failed:', e.message));

    res.json({ period: saved, skippedRefunded });
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

router.post('/payout-periods/:id/mark-paid', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = markPaidSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payment reference' });

  const { rows } = await query(
    `UPDATE referral_partner_payout_periods
     SET status = 'paid', paid_at = now(), payment_reference = $1
     WHERE id = $2 AND status = 'approved'
     RETURNING *`,
    [parsed.data.paymentReference || null, req.params.id]
  );
  if (!rows[0]) {
    return res.status(409).json({ error: 'Only an approved period can be marked paid.' });
  }
  await logAction({
    actorUserId: req.user.sub, action: 'referral_payout_period_paid',
    targetType: 'referral_partner_payout_period', targetId: req.params.id,
  });
  noticePartner(rows[0].referral_partner_id, {
    title: 'Commission paid',
    subject: `Commission paid: ${rows[0].statement_number}`,
    message: `your commission of $${Number(rows[0].total).toFixed(2)} (statement ${rows[0].statement_number}) has been paid`
      + `${parsed.data.paymentReference ? `. Reference: ${parsed.data.paymentReference}` : ''}. It should be in your account shortly.`,
  }).catch((e) => console.error('partner paid notice failed:', e.message));
  res.json({ period: rows[0] });
}));

router.get('/payout-periods/:id/statement.pdf', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT pp.*, p.name AS partner_name, p.abn AS partner_abn,
            p.address, p.suburb, p.postcode, p.state, p.is_gst_registered
     FROM referral_partner_payout_periods pp
     JOIN referral_partners p ON p.id = pp.referral_partner_id
     WHERE pp.id = $1`,
    [req.params.id]
  );
  const period = rows[0];
  if (!period) return res.status(404).json({ error: 'Payout period not found' });

  // A partner may fetch only their own statement; admin may fetch any.
  if (req.user.role === 'referral_partner') {
    const partnerId = await partnerIdForUser(req.user.sub);
    if (partnerId !== period.referral_partner_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } else if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { rows: items } = await query(
    'SELECT * FROM referral_partner_payout_items WHERE period_id = $1 ORDER BY job_date', [period.id]
  );
  const { rows: companyRows } = await query('SELECT config FROM content_settings WHERE id = true');

  const buffer = await generateReferralStatementPdfBuffer({
    period,
    items: items.map((i) => ({
      ...i,
      description: describeCommission(i.job_total, { commission_type: i.commission_type, commission_value: i.commission_value }),
    })),
    company: companyRows[0]?.config?.company || { name: 'Goodbye Mate' },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${period.statement_number || 'statement'}.pdf"`);
  res.send(buffer);
}));

export default router;
