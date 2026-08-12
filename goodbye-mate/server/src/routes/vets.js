import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query, pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAction } from '../audit/log.js';

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

// Creates the login user (role='vet', a random unusable password — the
// vet sets their own via a "set up your account" invite flow, not built
// yet, see README) and the linked vets row in one transaction.
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const parsed = createVetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid vet', details: parsed.error.flatten() });
  const d = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tempPasswordHash = await bcrypt.hash(crypto.randomUUID(), 12);

    const { rows: userRows } = await client.query(
      `INSERT INTO users (email, password_hash, role, full_name, phone) VALUES ($1,$2,'vet',$3,$4) RETURNING id`,
      [d.email.toLowerCase(), tempPasswordHash, d.fullName, d.phone]
    );
    const userId = userRows[0].id;

    const { rows: vetRows } = await client.query(
      `INSERT INTO vets (user_id, reg_number, reg_state, abn, is_gst_registered, postcodes, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [userId, d.regNumber || null, d.regState || null, d.abn || null, d.isGstRegistered, d.postcodes, d.color || '#4A6B5A']
    );

    await client.query('COMMIT');
    await logAction({ actorUserId: req.user.sub, action: 'vet_created', targetType: 'vet', targetId: vetRows[0].id });
    res.status(201).json({ vet: vetRows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'A user with that email already exists' });
    throw err;
  } finally {
    client.release();
  }
});

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await query(
    `SELECT v.*, u.full_name, u.email, u.phone, u.is_active
     FROM vets v JOIN users u ON u.id = v.user_id ORDER BY u.full_name`
  );
  res.json({ vets: rows });
});

// IMPORTANT: this must be registered before GET '/:vetId' — otherwise
// Express matches "/matching" as vetId="matching".
router.get('/matching', requireAuth, requireRole('admin'), async (req, res) => {
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
});

router.get('/:vetId', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT v.*, u.full_name, u.email, u.phone, u.is_active
     FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
    [req.params.vetId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Vet not found' });
  res.json({ vet: rows[0] });
});

const updateProfileSchema = z.object({
  regNumber: z.string().optional(),
  regState: z.string().optional(),
  abn: z.string().optional(),
  isGstRegistered: z.boolean().optional(),
  postcodes: z.array(z.string()).optional(),
  color: z.string().optional(),
});

// Vets can edit their own profile (per the brief's "self-service edit of
// all their own details"); admins can edit anyone's.
router.put('/:vetId/profile', requireAuth, async (req, res) => {
  const { rows: vetRows } = await query('SELECT user_id FROM vets WHERE id = $1', [req.params.vetId]);
  if (!vetRows[0]) return res.status(404).json({ error: 'Vet not found' });
  if (req.user.role !== 'admin' && req.user.sub !== vetRows[0].user_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid profile', details: parsed.error.flatten() });
  const d = parsed.data;

  const { rows } = await query(
    `UPDATE vets SET
       reg_number = COALESCE($1, reg_number),
       reg_state = COALESCE($2, reg_state),
       abn = COALESCE($3, abn),
       is_gst_registered = COALESCE($4, is_gst_registered),
       postcodes = COALESCE($5, postcodes),
       color = COALESCE($6, color),
       updated_at = now()
     WHERE id = $7 RETURNING *`,
    [d.regNumber, d.regState, d.abn, d.isGstRegistered, d.postcodes, d.color, req.params.vetId]
  );
  res.json({ vet: rows[0] });
});

// Weekly hour-by-hour availability. Note: this is still ONE recurring
// weekly pattern (matches the prototype), not true per-specific-week
// schedules — that upgrade is still open, see README.
const weeklyHoursSchema = z.record(z.record(z.boolean())); // { "mon": { "8": true, ... }, ... }

router.put('/:vetId/weekly-hours', requireAuth, async (req, res) => {
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
});

// One-off date overrides — blocked/available for a specific calendar date.
router.put('/:vetId/date-overrides/:date', requireAuth, async (req, res) => {
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
});

// Note templates — a vet's personal reusable medical-note snippets.
router.get('/:vetId/note-templates', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT * FROM vet_note_templates WHERE vet_id = $1 ORDER BY created_at', [req.params.vetId]);
  res.json({ templates: rows });
});

router.post('/:vetId/note-templates', requireAuth, async (req, res) => {
  const { label, text } = req.body;
  if (!label || !text) return res.status(400).json({ error: 'label and text required' });

  const { rows } = await query(
    `INSERT INTO vet_note_templates (vet_id, label, text) VALUES ($1, $2, $3) RETURNING *`,
    [req.params.vetId, label, text]
  );
  res.status(201).json({ template: rows[0] });
});

// GeoJSON polygon coming from the frontend's drawing tool.
const territorySchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
});

// Save/replace a vet's territory. Admin-only — territory assignment is
// an admin decision, even though the vet whose territory it is might
// eventually get a read-only view of their own.
router.put('/:vetId/territory', requireAuth, requireRole('admin'), async (req, res) => {
  const { vetId } = req.params;
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
});

router.get('/:vetId/territory', requireAuth, async (req, res) => {
  const { vetId } = req.params;
  const { rows } = await query(
    `SELECT ST_AsGeoJSON(territory) AS geojson FROM vets WHERE id = $1`,
    [vetId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Vet not found' });
  res.json({ geojson: rows[0].geojson ? JSON.parse(rows[0].geojson) : null });
});

export default router;
