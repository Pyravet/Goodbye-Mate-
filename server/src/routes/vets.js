import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query, pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAction } from '../audit/log.js';
import { rankVetsByLocation } from '../domain/dispatch.js';
import { getVetsWithContextForJob } from '../domain/vetContext.js';
import { encrypt, decrypt, isEncryptionConfigured, maskTail } from '../security/encryption.js';
import { sendEmail, isEmailConfigured } from '../integrations/email/smtp.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { payoutBreakdown, extractGst } from '../domain/pricing.js';

const router = Router();

const createVetSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  regNumber: z.string().optional(),
  regState: z.string().optional(),
  abn: z.string().optional(),
  isGstRegistered: z.boolean().default(false),
  postcodes: z.array(z.string()).default([]),
  color: z.string().optional(),
});

// Generates a short, easy-to-read-aloud temporary password — since there's
// no email delivery system yet, admin shares this with the vet directly
// (phone/SMS/in person). Returned once in this response only; never
// retrievable again. The vet should change it after first login.
function generateTempPassword() {
  const words = ['maple', 'harbor', 'cedar', 'willow', 'granite', 'amber', 'copper', 'meadow', 'summit', 'quartz'];
  const word = words[Math.floor(Math.random() * words.length)];
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${word}${digits}`;
}

// Creates the login user (role='vet', a real temporary password returned
// once in this response) and the linked vets row in one transaction.
router.post('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = createVetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid vet', details: parsed.error.flatten() });
  const d = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const { rows: userRows } = await client.query(
      `INSERT INTO users (email, password_hash, role, full_name, phone) VALUES ($1,$2,'vet',$3,$4) RETURNING id`,
      [d.email.toLowerCase(), passwordHash, d.fullName, d.phone]
    );
    const userId = userRows[0].id;

    const { rows: vetRows } = await client.query(
      `INSERT INTO vets (user_id, reg_number, reg_state, abn, is_gst_registered, postcodes, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [userId, d.regNumber || null, d.regState || null, d.abn || null, d.isGstRegistered, d.postcodes, d.color || '#4A6B5A']
    );

    await client.query('COMMIT');
    await logAction({ actorUserId: req.user.sub, action: 'vet_created', targetType: 'vet', targetId: vetRows[0].id });

    // Best-effort — email delivery failing shouldn't block vet creation,
    // since the temp password is also shown once in the admin UI as a
    // fallback either way.
    if (isEmailConfigured()) {
      sendEmail({
        to: d.email.toLowerCase(),
        subject: 'Your Goodbye Mate vet account',
        text: `Hi ${d.fullName},\n\nAn account has been created for you.\n\nEmail: ${d.email.toLowerCase()}\nTemporary password: ${tempPassword}\n\nPlease log in and change your password as soon as possible.\n\nThanks,\nGoodbye Mate`,
      }).catch((err) => console.error('Vet welcome email failed:', err.message));
    }

    res.status(201).json({ vet: vetRows[0], tempPassword, loginEmail: d.email.toLowerCase() });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'A user with that email already exists' });
    throw err;
  } finally {
    client.release();
  }
}));

router.get('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT v.*, u.full_name, u.email, u.phone, u.is_active
     FROM vets v JOIN users u ON u.id = v.user_id ORDER BY u.full_name`
  );
  res.json({ vets: rows });
}));

// IMPORTANT: this must be registered before GET '/:vetId' — otherwise
// Express matches "/matching" as vetId="matching".
router.get('/matching', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const lng = Number(req.query.lng);
  const lat = Number(req.query.lat);
  if (Number.isNaN(lng) || Number.isNaN(lat)) {
    return res.status(400).json({ error: 'lng and lat query params are required numbers' });
  }

  const { rows } = await query(
    `SELECT v.id, u.full_name
     FROM vets v
     JOIN users u ON u.id = v.user_id
     WHERE v.territory IS NOT NULL
       AND ST_Contains(v.territory::geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))`,
    [lng, lat]
  );

  res.json({ vets: rows });
}));

// Quick postcode check — "who's the nearest vet?" — for admin to preview
// before assigning, without needing a full job or lat/lng from Places.
// IMPORTANT: must be registered before GET '/:vetId' — otherwise Express
// matches "/nearest" as vetId="nearest".
router.get('/nearest', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const postcode = (req.query.postcode || '').trim();
  if (!postcode) return res.status(400).json({ error: 'postcode query param is required' });

  const lat = req.query.lat != null ? Number(req.query.lat) : null;
  const lng = req.query.lng != null ? Number(req.query.lng) : null;

  // getVetsWithContextForJob only reads .lat/.lng off this object — a
  // real job row isn't needed for a pre-booking location check.
  const vetsWithContext = await getVetsWithContextForJob({ lat, lng });
  const ranked = rankVetsByLocation(postcode, vetsWithContext);

  res.json({ postcode, ranked });
}));

// A vet fetching their own profile doesn't know their internal vets.id
// (only their user id, from the JWT) — this resolves that.
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT v.*, u.full_name, u.email, u.phone, u.is_active
     FROM vets v JOIN users u ON u.id = v.user_id WHERE v.user_id = $1`,
    [req.user.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Vet profile not found for this account' });

  const vet = rows[0];
  let bankDetails = null;
  if (isEncryptionConfigured()) {
    try {
      bankDetails = {
        accountName: decrypt(vet.bank_account_name_enc),
        bsb: vet.bank_bsb_enc ? maskTail(decrypt(vet.bank_bsb_enc), 2) : null,
        accountNumber: vet.bank_account_number_enc ? maskTail(decrypt(vet.bank_account_number_enc)) : null,
        hasBankDetails: !!vet.bank_account_number_enc,
      };
    } catch {
      bankDetails = { hasBankDetails: !!vet.bank_account_number_enc, error: 'Could not decrypt' };
    }
  }
  delete vet.bank_account_name_enc;
  delete vet.bank_bsb_enc;
  delete vet.bank_account_number_enc;

  res.json({ vet, bankDetails });
}));

// Payout summary for a vet: today/week/month/all-time totals from completed
// jobs, plus a week-by-week breakdown for history.
router.get('/:vetId/earnings', requireAuth, asyncHandler(async (req, res) => {
  const { rows: vetRows } = await query('SELECT user_id, is_gst_registered FROM vets WHERE id = $1', [req.params.vetId]);
  if (!vetRows[0]) return res.status(404).json({ error: 'Vet not found' });
  if (req.user.role !== 'admin' && req.user.sub !== vetRows[0].user_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const pricing = pricingRows[0].config;

  const { rows: jobs } = await query(
    `SELECT * FROM jobs WHERE assigned_vet_id = $1 AND status = 'completed' ORDER BY job_date DESC`,
    [req.params.vetId]
  );
  const { rows: upcomingRows } = await query(
    `SELECT * FROM jobs WHERE assigned_vet_id = $1 AND status NOT IN ('completed','cancelled')`,
    [req.params.vetId]
  );

  const today = new Date().toISOString().slice(0, 10);
  const startOfWeek = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().slice(0, 10);
  };
  const startOfMonth = today.slice(0, 7) + '-01';
  const thisWeekStart = startOfWeek(today);

  let todayTotal = 0, weekTotal = 0, monthTotal = 0, allTimeTotal = 0;
  const byWeek = {};

  for (const job of jobs) {
    const jobDate = typeof job.job_date === 'string' ? job.job_date.slice(0, 10) : new Date(job.job_date).toISOString().slice(0, 10);
    const payout = payoutBreakdown(job, pricing);
    allTimeTotal += payout.total;
    if (jobDate === today) todayTotal += payout.total;
    if (jobDate >= thisWeekStart) weekTotal += payout.total;
    if (jobDate >= startOfMonth) monthTotal += payout.total;

    const weekKey = startOfWeek(jobDate);
    if (!byWeek[weekKey]) byWeek[weekKey] = { weekStart: weekKey, total: 0, jobCount: 0, jobs: [] };
    byWeek[weekKey].total += payout.total;
    byWeek[weekKey].jobCount += 1;
    byWeek[weekKey].jobs.push({ id: job.id, jobNumber: job.job_number, petName: job.pet_name, jobDate, payout: payout.total });
  }

  const upcomingTotal = upcomingRows.reduce((sum, job) => sum + payoutBreakdown(job, pricing).total, 0);

  const weeklyHistory = Object.values(byWeek).sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  res.json({
    today: todayTotal,
    thisWeek: weekTotal,
    thisMonth: monthTotal,
    allTime: allTimeTotal,
    upcoming: upcomingTotal,
    weeklyHistory,
  });
}));

router.get('/:vetId', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT v.*, u.full_name, u.email, u.phone, u.is_active
     FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
    [req.params.vetId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Vet not found' });

  const vet = rows[0];
  // Only the vet themselves or an admin can see even the masked bank
  // details — decrypt lazily and never return the raw encrypted columns.
  const canSeeBankDetails = req.user.role === 'admin' || req.user.sub === vet.user_id;
  let bankDetails = null;
  if (canSeeBankDetails && isEncryptionConfigured()) {
    try {
      bankDetails = {
        accountName: decrypt(vet.bank_account_name_enc),
        bsb: vet.bank_bsb_enc ? maskTail(decrypt(vet.bank_bsb_enc), 2) : null,
        accountNumber: vet.bank_account_number_enc ? maskTail(decrypt(vet.bank_account_number_enc)) : null,
        hasBankDetails: !!vet.bank_account_number_enc,
      };
    } catch {
      bankDetails = { hasBankDetails: !!vet.bank_account_number_enc, error: 'Could not decrypt' };
    }
  }
  delete vet.bank_account_name_enc;
  delete vet.bank_bsb_enc;
  delete vet.bank_account_number_enc;

  res.json({ vet, bankDetails });
}));

const updateProfileSchema = z.object({
  regNumber: z.string().optional(),
  regState: z.string().optional(),
  abn: z.string().optional(),
  isGstRegistered: z.boolean().optional(),
  postcodes: z.array(z.string()).optional(),
  color: z.string().optional(),
  // Personal details
  phone: z.string().optional(),
  address: z.string().optional(),
  suburb: z.string().optional(),
  postcode: z.string().optional(),
  state: z.string().optional(),
  // Bank details — only written if provided; never returned in plaintext.
  bankAccountName: z.string().optional(),
  bankBsb: z.string().optional(),
  bankAccountNumber: z.string().optional(),
});

// Vets can edit their own profile (per the brief's "self-service edit of
// all their own details"); admins can edit anyone's.
router.put('/:vetId/profile', requireAuth, asyncHandler(async (req, res) => {
  const { rows: vetRows } = await query('SELECT user_id FROM vets WHERE id = $1', [req.params.vetId]);
  if (!vetRows[0]) return res.status(404).json({ error: 'Vet not found' });
  if (req.user.role !== 'admin' && req.user.sub !== vetRows[0].user_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid profile', details: parsed.error.flatten() });
  const d = parsed.data;

  const wantsBankUpdate = d.bankAccountName || d.bankBsb || d.bankAccountNumber;
  if (wantsBankUpdate && !isEncryptionConfigured()) {
    return res.status(503).json({ error: 'Bank detail storage is not configured yet — contact the admin.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (d.phone !== undefined) {
      await client.query('UPDATE users SET phone = COALESCE($1, phone), updated_at = now() WHERE id = $2', [d.phone, vetRows[0].user_id]);
    }

    const { rows } = await client.query(
      `UPDATE vets SET
         reg_number = COALESCE($1, reg_number),
         reg_state = COALESCE($2, reg_state),
         abn = COALESCE($3, abn),
         is_gst_registered = COALESCE($4, is_gst_registered),
         postcodes = COALESCE($5, postcodes),
         color = COALESCE($6, color),
         address = COALESCE($7, address),
         suburb = COALESCE($8, suburb),
         postcode = COALESCE($9, postcode),
         state = COALESCE($10, state),
         bank_account_name_enc = COALESCE($11, bank_account_name_enc),
         bank_bsb_enc = COALESCE($12, bank_bsb_enc),
         bank_account_number_enc = COALESCE($13, bank_account_number_enc),
         updated_at = now()
       WHERE id = $14 RETURNING id`,
      [
        d.regNumber, d.regState, d.abn, d.isGstRegistered, d.postcodes, d.color,
        d.address, d.suburb, d.postcode, d.state,
        d.bankAccountName ? encrypt(d.bankAccountName) : null,
        d.bankBsb ? encrypt(d.bankBsb) : null,
        d.bankAccountNumber ? encrypt(d.bankAccountNumber) : null,
        req.params.vetId,
      ]
    );

    await client.query('COMMIT');
    await logAction({ actorUserId: req.user.sub, action: 'vet_profile_updated', targetType: 'vet', targetId: req.params.vetId });
    res.json({ vet: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// Approve a pending self-signup vet (or reactivate a deactivated one) —
// this is literally the login gate, since login already blocks
// is_active = false accounts.
router.put('/:vetId/approve', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows: vetRows } = await query('SELECT user_id FROM vets WHERE id = $1', [req.params.vetId]);
  if (!vetRows[0]) return res.status(404).json({ error: 'Vet not found' });

  await query('UPDATE users SET is_active = true, updated_at = now() WHERE id = $1', [vetRows[0].user_id]);
  await logAction({ actorUserId: req.user.sub, action: 'vet_approved', targetType: 'vet', targetId: req.params.vetId });

  if (isEmailConfigured()) {
    const { rows: userRows } = await query('SELECT email, full_name FROM users WHERE id = $1', [vetRows[0].user_id]);
    const u = userRows[0];
    if (u) {
      sendEmail({
        to: u.email,
        subject: 'Your Goodbye Mate account is approved',
        text: `Hi ${u.full_name},\n\nYour vet account has been approved — you can now log in with the email and password you signed up with.\n\nThanks,\nGoodbye Mate`,
      }).catch((err) => console.error('Vet approval email failed:', err.message));
    }
  }

  res.json({ ok: true });
}));

// Deactivate a vet — e.g. registration lapsed, or they've stopped
// contracting. Blocks login immediately.
router.put('/:vetId/deactivate', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows: vetRows } = await query('SELECT user_id FROM vets WHERE id = $1', [req.params.vetId]);
  if (!vetRows[0]) return res.status(404).json({ error: 'Vet not found' });

  await query('UPDATE users SET is_active = false, updated_at = now() WHERE id = $1', [vetRows[0].user_id]);
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [vetRows[0].user_id]);
  await logAction({ actorUserId: req.user.sub, action: 'vet_deactivated', targetType: 'vet', targetId: req.params.vetId });
  res.json({ ok: true });
}));

// Weekly hour-by-hour availability. Note: this is still ONE recurring
// weekly pattern (matches the prototype), not true per-specific-week
// schedules — that upgrade is still open, see README.
const weeklyHoursSchema = z.record(z.record(z.boolean())); // { "mon": { "8": true, ... }, ... }

router.put('/:vetId/weekly-hours', requireAuth, asyncHandler(async (req, res) => {
  const { rows: vetRows } = await query('SELECT user_id FROM vets WHERE id = $1', [req.params.vetId]);
  if (!vetRows[0]) return res.status(404).json({ error: 'Vet not found' });
  if (req.user.role !== 'admin' && req.user.sub !== vetRows[0].user_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const parsed = weeklyHoursSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid weekly hours', details: parsed.error.flatten() });

  const { rows } = await query(
    `UPDATE vets SET weekly_hours = $1, updated_at = now() WHERE id = $2 RETURNING id, weekly_hours`,
    [JSON.stringify(parsed.data), req.params.vetId]
  );
  res.json({ vet: rows[0] });
}));

// One-off date overrides — blocked/available for a specific calendar date.
router.put('/:vetId/date-overrides/:date', requireAuth, asyncHandler(async (req, res) => {
  const { available } = req.body; // boolean, or null to clear the override
  const { rows: vetRows } = await query('SELECT user_id, date_overrides FROM vets WHERE id = $1', [req.params.vetId]);
  if (!vetRows[0]) return res.status(404).json({ error: 'Vet not found' });
  if (req.user.role !== 'admin' && req.user.sub !== vetRows[0].user_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const overrides = { ...vetRows[0].date_overrides };
  if (available === null) delete overrides[req.params.date];
  else overrides[req.params.date] = available;

  const { rows } = await query(
    `UPDATE vets SET date_overrides = $1, updated_at = now() WHERE id = $2 RETURNING id, date_overrides`,
    [JSON.stringify(overrides), req.params.vetId]
  );
  res.json({ vet: rows[0] });
}));

// Note templates — a vet's personal reusable medical-note snippets.
router.get('/:vetId/note-templates', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM vet_note_templates WHERE vet_id = $1 ORDER BY created_at', [req.params.vetId]);
  res.json({ templates: rows });
}));

router.post('/:vetId/note-templates', requireAuth, asyncHandler(async (req, res) => {
  const { label, text } = req.body;
  if (!label || !text) return res.status(400).json({ error: 'label and text required' });

  const { rows } = await query(
    `INSERT INTO vet_note_templates (vet_id, label, text) VALUES ($1, $2, $3) RETURNING *`,
    [req.params.vetId, label, text]
  );
  res.status(201).json({ template: rows[0] });
}));

// GeoJSON polygon coming from the frontend's drawing tool.
const territorySchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
});

// Save/replace a vet's territory. Admin can set any vet's; a vet can draw
// and save their own (matches the same "admin OR the vet themself" pattern
// used for weekly-hours/date-overrides/profile).
router.put('/:vetId/territory', requireAuth, asyncHandler(async (req, res) => {
  const { vetId } = req.params;

  if (req.user.role !== 'admin') {
    const { rows: vetRows } = await query('SELECT user_id FROM vets WHERE id = $1', [vetId]);
    if (!vetRows[0]) return res.status(404).json({ error: 'Vet not found' });
    if (req.user.sub !== vetRows[0].user_id) return res.status(403).json({ error: 'Forbidden' });
  }

  const parsed = territorySchema.safeParse(req.body.geojson);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid territory GeoJSON', details: parsed.error.flatten() });
  }

  const geojson = JSON.stringify(parsed.data);

  const { rows } = await query(
    `UPDATE vets
     SET territory = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography,
         territory_updated_at = now(),
         updated_at = now()
     WHERE id = $2
     RETURNING id`,
    [geojson, vetId]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Vet not found' });

  await logAction({
    actorUserId: req.user.sub,
    action: 'vet_territory_updated',
    targetType: 'vet',
    targetId: vetId,
  });

  res.json({ ok: true });
}));

router.get('/:vetId/territory', requireAuth, asyncHandler(async (req, res) => {
  const { vetId } = req.params;

  if (req.user.role !== 'admin') {
    const { rows: vetRows } = await query('SELECT user_id FROM vets WHERE id = $1', [vetId]);
    if (!vetRows[0]) return res.status(404).json({ error: 'Vet not found' });
    if (req.user.sub !== vetRows[0].user_id) return res.status(403).json({ error: 'Forbidden' });
  }

  const { rows } = await query(
    `SELECT ST_AsGeoJSON(territory) AS geojson FROM vets WHERE id = $1`,
    [vetId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Vet not found' });
  res.json({ geojson: rows[0].geojson ? JSON.parse(rows[0].geojson) : null });
}));

export default router;
