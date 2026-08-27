import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logAction } from '../audit/log.js';
import { notifyAdmins } from '../notifications/notify.js';
import { sendSlackMessage } from '../integrations/slack/webhook.js';

const router = Router();

/**
 * The clinic this user belongs to.
 *
 * EVERY clinic-facing query is scoped through this. A clinic seeing
 * another clinic's referrals would expose a competitor's client list —
 * so the clinic id comes from the SESSION, never from the request body
 * or a query parameter, which is the only way it can't be tampered with.
 */
async function clinicIdForUser(userId) {
  const { rows } = await query('SELECT clinic_id FROM clinic_users WHERE user_id = $1', [userId]);
  return rows[0]?.clinic_id || null;
}

// ============================================================
// CLINIC-FACING — a clinic user, scoped to their own clinic
// ============================================================

router.get('/me', requireAuth, requireRole('clinic'), asyncHandler(async (req, res) => {
  const clinicId = await clinicIdForUser(req.user.sub);
  if (!clinicId) return res.status(403).json({ error: 'This login is not linked to a clinic.' });

  const { rows } = await query('SELECT * FROM clinics WHERE id = $1', [clinicId]);
  if (!rows[0]?.is_active) {
    return res.status(403).json({ error: 'This clinic account is not active. Please contact us.' });
  }
  res.json({ clinic: rows[0] });
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
 * POST /clinics/referrals — refer a client.
 *
 * Creates a booking_request, the same object the public form creates, so
 * it lands in the admin inbox admin already works from and the existing
 * convert-to-job flow applies unchanged. The only difference is the
 * clinic attribution.
 */
router.post('/referrals', requireAuth, requireRole('clinic'), asyncHandler(async (req, res) => {
  const clinicId = await clinicIdForUser(req.user.sub);
  if (!clinicId) return res.status(403).json({ error: 'This login is not linked to a clinic.' });

  const parsed = referralSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid referral' });
  }
  const d = parsed.data;

  const { rows: clinicRows } = await query('SELECT name, is_active FROM clinics WHERE id = $1', [clinicId]);
  if (!clinicRows[0]?.is_active) {
    return res.status(403).json({ error: 'This clinic account is not active.' });
  }

  const { rows } = await query(
    `INSERT INTO booking_requests
       (client_name, client_phone, client_email, pet_name, pet_type, pet_breed,
        suburb, postcode, service_preference, preferred_timing, message,
        referred_by_clinic_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'new')
     RETURNING id, created_at`,
    [
      d.clientName, d.clientPhone, d.clientEmail || null, d.petName,
      d.petType || null, d.petBreed || null, d.suburb || null, d.postcode || null,
      d.servicePreference || null, d.preferredTiming || null, d.message || null,
      clinicId,
    ]
  );

  // A clinic referral is more urgent than a web enquiry: a vet has a
  // family in front of them expecting a call back, and the clinic's own
  // reputation is attached to how quickly that happens.
  notifyAdmins({
    title: 'Referral from a clinic',
    body: `${clinicRows[0].name} referred ${d.clientName} for ${d.petName}. `
      + `${d.preferredTiming ? `Timing: ${d.preferredTiming}.` : ''}`,
    url: '/requests',
    category: 'job',
  }).catch((e) => console.error('clinic referral notify failed:', e.message));

  sendSlackMessage(
    `🏥 *Referral from ${clinicRows[0].name}* — ${d.clientName} / ${d.petName}`
    + `${d.preferredTiming ? ` · ${d.preferredTiming}` : ''}`
  ).catch((e) => console.error('clinic referral slack failed:', e.message));

  await logAction({
    actorUserId: req.user.sub, action: 'clinic_referral_created',
    targetType: 'booking_request', targetId: rows[0].id, metadata: { clinicId },
  });

  res.status(201).json({ referral: rows[0] });
}));

/**
 * GET /clinics/referrals — the clinic's own referrals and what became of them.
 *
 * This is the point of the portal. A clinic currently hands over a phone
 * number and never learns whether the family was looked after.
 *
 * DELIBERATELY LIMITED FIELDS. The clinic sees the outcome of a referral
 * they made, not the job record: no address, no pricing, no vet details,
 * no clinical notes. They referred a client; that doesn't entitle them
 * to the visit's contents.
 */
router.get('/referrals', requireAuth, requireRole('clinic'), asyncHandler(async (req, res) => {
  const clinicId = await clinicIdForUser(req.user.sub);
  if (!clinicId) return res.status(403).json({ error: 'This login is not linked to a clinic.' });

  const { rows } = await query(
    `SELECT r.id, r.client_name, r.pet_name, r.pet_type, r.created_at, r.status,
            r.preferred_timing,
            j.job_number, j.job_date, j.status AS job_status
     FROM booking_requests r
     LEFT JOIN jobs j ON j.id = r.converted_job_id
     WHERE r.referred_by_clinic_id = $1
     ORDER BY r.created_at DESC
     LIMIT 200`,
    [clinicId]
  );

  const { rows: stats } = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE converted_job_id IS NOT NULL)::int AS converted,
            COUNT(*) FILTER (WHERE status = 'new')::int AS awaiting_contact
     FROM booking_requests WHERE referred_by_clinic_id = $1`,
    [clinicId]
  );

  res.json({ referrals: rows, stats: stats[0] });
}));

// ============================================================
// ADMIN-FACING — managing clinics and their logins
// ============================================================

router.get('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT c.*,
            (SELECT COUNT(*)::int FROM booking_requests r WHERE r.referred_by_clinic_id = c.id) AS referral_count,
            (SELECT COUNT(*)::int FROM jobs j WHERE j.referred_by_clinic_id = c.id) AS job_count,
            (SELECT COUNT(*)::int FROM clinic_users u WHERE u.clinic_id = c.id) AS user_count
     FROM clinics c ORDER BY c.is_active DESC, c.name`
  );
  res.json({ clinics: rows });
}));

const clinicSchema = z.object({
  name: z.string().trim().min(1, 'The clinic needs a name.'),
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
  notes: z.string().trim().max(2000).optional().nullable(),
});

router.post('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = clinicSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid clinic' });
  }
  const d = parsed.data;
  const { rows } = await query(
    `INSERT INTO clinics (name, phone, email, address, suburb, postcode, state, abn, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [d.name, d.phone || null, d.email || null, d.address || null, d.suburb || null,
     d.postcode || null, d.state || null, d.abn || null, d.notes || null]
  );
  await logAction({
    actorUserId: req.user.sub, action: 'clinic_created',
    targetType: 'clinic', targetId: rows[0].id, metadata: { name: d.name },
  });
  res.status(201).json({ clinic: rows[0] });
}));

router.put('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = clinicSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid clinic' });
  }
  const d = parsed.data;
  const { rows } = await query(
    `UPDATE clinics SET name=$1, phone=$2, email=$3, address=$4, suburb=$5,
       postcode=$6, state=$7, abn=$8, notes=$9, updated_at=now()
     WHERE id=$10 RETURNING *`,
    [d.name, d.phone || null, d.email || null, d.address || null, d.suburb || null,
     d.postcode || null, d.state || null, d.abn || null, d.notes || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Clinic not found' });
  res.json({ clinic: rows[0] });
}));

/**
 * Deactivate rather than delete. A clinic that leaves still has
 * referrals attributed to it, and those records must keep the
 * attribution that explains where the job came from.
 */
router.post('/:id/set-active', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const isActive = req.body?.isActive === true;
  const { rows } = await query(
    'UPDATE clinics SET is_active=$1, updated_at=now() WHERE id=$2 RETURNING *',
    [isActive, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Clinic not found' });
  await logAction({
    actorUserId: req.user.sub, action: isActive ? 'clinic_activated' : 'clinic_deactivated',
    targetType: 'clinic', targetId: req.params.id,
  });
  res.json({ clinic: rows[0] });
}));

/**
 * Create a login for a clinic.
 *
 * Admin sets the initial password and passes it on. Deliberately not
 * emailed from here: email delivery isn't proven, and a login that
 * silently never arrives is worse than one handed over on the phone.
 */
const clinicUserSchema = z.object({
  fullName: z.string().trim().min(1, 'A name is needed.'),
  email: z.string().trim().email('That email address is not valid.'),
  password: z.string().min(10, 'Use at least 10 characters.'),
});

router.post('/:id/users', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = clinicUserSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid login' });
  }
  const d = parsed.data;

  const { rows: clinicRows } = await query('SELECT id FROM clinics WHERE id = $1', [req.params.id]);
  if (!clinicRows[0]) return res.status(404).json({ error: 'Clinic not found' });

  const { rows: existing } = await query(
    'SELECT id FROM users WHERE lower(email) = lower($1)', [d.email]
  );
  if (existing[0]) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const bcrypt = (await import('bcryptjs')).default;
  const { rows } = await query(
    `INSERT INTO users (email, full_name, password_hash, role, is_active)
     VALUES ($1,$2,$3,'clinic',true) RETURNING id, email, full_name`,
    [d.email.toLowerCase(), d.fullName, await bcrypt.hash(d.password, 10)]
  );
  await query('INSERT INTO clinic_users (user_id, clinic_id) VALUES ($1,$2)',
    [rows[0].id, req.params.id]);

  await logAction({
    actorUserId: req.user.sub, action: 'clinic_user_created',
    targetType: 'clinic', targetId: req.params.id, metadata: { email: d.email },
  });

  res.status(201).json({ user: rows[0] });
}));

router.get('/:id/users', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.email, u.full_name, u.is_active
     FROM clinic_users cu JOIN users u ON u.id = cu.user_id
     WHERE cu.clinic_id = $1 ORDER BY u.full_name`,
    [req.params.id]
  );
  res.json({ users: rows });
}));

export default router;
