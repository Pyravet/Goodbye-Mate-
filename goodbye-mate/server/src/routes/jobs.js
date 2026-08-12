import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAction } from '../audit/log.js';
import { billBreakdown, payoutBreakdown, suggestTimeCategory } from '../domain/pricing.js';
import { rankVets, DISPATCH_TIMEOUT_MS } from '../domain/dispatch.js';
import { getVetsWithContextForJob } from '../domain/vetContext.js';

const router = Router();

const createJobSchema = z.object({
  clientName: z.string().min(1),
  clientPhone: z.string().min(1),
  clientEmail: z.string().email().optional().nullable(),
  address: z.string().min(1),
  suburb: z.string().optional(),
  postcode: z.string().min(1),
  state: z.string().min(1),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  petName: z.string().min(1),
  petType: z.string().min(1),
  petBreed: z.string().optional(),
  petWeight: z.string().optional(),
  petAge: z.string().optional(),
  petBehaviour: z.string().optional(),
  serviceId: z.string().default('svc_euth'),
  serviceType: z.enum(['euthanasia_only', 'private_cremation', 'communal_cremation']),
  date: z.string(), // YYYY-MM-DD
  time: z.string(), // HH:MM
  extraTravelFee: z.number().optional().default(0),
  notes: z.string().optional(),
});

// Kicks off (or re-kicks) an auto-dispatch offer: ranks vets, offers to
// the best match, sets the offer expiry. Called on job creation and by
// the timeout-rollover worker.
async function startOrRollDispatch(jobId) {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job) return null;

  const vetsWithContext = await getVetsWithContextForJob(job);
  const declined = job.dispatch_declined_vet_ids || [];
  const ranked = rankVets(job, vetsWithContext).filter((r) => !declined.includes(r.vetId) && r.score > -150);
  const next = ranked[0];

  if (next) {
    const expiresAt = new Date(Date.now() + DISPATCH_TIMEOUT_MS);
    await query(
      `UPDATE jobs SET dispatch_state = 'offered', dispatch_offered_vet_id = $1, dispatch_expires_at = $2, updated_at = now() WHERE id = $3`,
      [next.vetId, expiresAt, jobId]
    );
    return { state: 'offered', offeredVetId: next.vetId, expiresAt };
  } else {
    await query(
      `UPDATE jobs SET dispatch_state = 'unassigned', dispatch_offered_vet_id = NULL, dispatch_expires_at = NULL, updated_at = now() WHERE id = $1`,
      [jobId]
    );
    return { state: 'unassigned' };
  }
}

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid job', details: parsed.error.flatten() });
  const d = parsed.data;

  const timeCategory = suggestTimeCategory(d.date, d.time);

  const { rows } = await query(
    `INSERT INTO jobs (
      client_name, client_phone, client_email, address, suburb, postcode, state, lat, lng,
      pet_name, pet_type, pet_breed, pet_weight, pet_age, pet_behaviour,
      service_id, service_type, job_date, job_time, time_category, extra_travel_fee, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
    RETURNING *`,
    [
      d.clientName, d.clientPhone, d.clientEmail || null, d.address, d.suburb || null, d.postcode, d.state, d.lat ?? null, d.lng ?? null,
      d.petName, d.petType, d.petBreed || null, d.petWeight || null, d.petAge || null, d.petBehaviour || 'Friendly',
      d.serviceId, d.serviceType, d.date, d.time, timeCategory, d.extraTravelFee || 0, d.notes || null,
    ]
  );
  const job = rows[0];

  await logAction({ actorUserId: req.user.sub, action: 'job_created', targetType: 'job', targetId: job.id, metadata: { jobNumber: job.job_number } });

  // Kick off auto-dispatch immediately.
  const dispatch = await startOrRollDispatch(job.id);

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const bill = billBreakdown(job, pricingRows[0].config);

  res.status(201).json({ job, dispatch, bill });
});

// Today / Upcoming / Past / Board (all) — the four admin views from the brief.
router.get('/', requireAuth, async (req, res) => {
  const { view, search } = req.query;
  const conditions = [];
  const params = [];

  if (view === 'today') {
    conditions.push(`job_date = CURRENT_DATE`);
  } else if (view === 'upcoming') {
    conditions.push(`job_date > CURRENT_DATE AND status NOT IN ('completed','cancelled')`);
  } else if (view === 'past') {
    conditions.push(`(job_date < CURRENT_DATE OR status IN ('completed','cancelled'))`);
  }
  // 'board' (or no view param) = everything, for the status-board view.

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(client_name ILIKE $${params.length} OR pet_name ILIKE $${params.length} OR suburb ILIKE $${params.length} OR job_number ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM jobs ${where} ORDER BY job_date, job_time`, params);
  res.json({ jobs: rows });
});

router.get('/:id', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const pricing = pricingRows[0].config;
  const bill = billBreakdown(rows[0], pricing);
  const payout = payoutBreakdown(rows[0], pricing);

  res.json({ job: rows[0], bill, payout });
});

// At-risk alerts: unassigned-soon, unpaid, unsigned consent,
// cremation-not-booked-after-completion. Computed on demand rather than
// stored — matches the prototype's computeAlerts exactly.
router.get('/alerts/list', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows: jobs } = await query(
    `SELECT * FROM jobs WHERE status NOT IN ('completed', 'cancelled') OR (status = 'completed' AND service_type != 'euthanasia_only' AND NOT cremation_booked)`
  );

  const now = Date.now();
  const alerts = [];
  const CREMATION_STUCK_MS = 2 * 3600 * 1000;

  for (const j of jobs) {
    const apptTime = new Date(`${j.job_date.toISOString?.() ? j.job_date.toISOString().slice(0, 10) : j.job_date}T${j.job_time}`).getTime();
    const hrs = (apptTime - now) / 3600000;

    if (!j.assigned_vet_id && hrs < 4) {
      alerts.push({ jobId: j.id, jobNumber: j.job_number, severity: hrs < 0 ? 'high' : 'medium', message: `${j.pet_name} (${j.client_name}) has no vet assigned and is ${hrs < 0 ? 'overdue' : 'due soon'}.` });
    }
    if (j.dispatch_state === 'unassigned') {
      alerts.push({ jobId: j.id, jobNumber: j.job_number, severity: 'high', message: `No vet accepted the offer for ${j.pet_name} — needs manual assignment.` });
    }
    if (j.payment_status !== 'paid' && hrs < 24) {
      alerts.push({ jobId: j.id, jobNumber: j.job_number, severity: 'medium', message: `Payment still pending for ${j.pet_name}.` });
    }
    if (!j.consent_signed && hrs < 24) {
      alerts.push({ jobId: j.id, jobNumber: j.job_number, severity: 'medium', message: `Consent not yet signed for ${j.pet_name}.` });
    }
    if (j.procedure_done && j.service_type !== 'euthanasia_only' && !j.cremation_booked && j.procedure_done_at && (now - new Date(j.procedure_done_at).getTime()) > CREMATION_STUCK_MS) {
      alerts.push({ jobId: j.id, jobNumber: j.job_number, severity: 'high', message: `Cremation still not booked for ${j.pet_name} — procedure completed a while ago.` });
    }
  }

  alerts.sort((a, b) => (a.severity === 'high' ? -1 : 1) - (b.severity === 'high' ? -1 : 1));
  res.json({ alerts });
});

// Manual assignment — either from the ranked list or the "assign any
// other vet" escape hatch for vets travelling outside their territory.
router.post('/:id/assign', requireAuth, requireRole('admin'), async (req, res) => {
  const { vetId } = req.body;
  if (!vetId) return res.status(400).json({ error: 'vetId required' });

  const { rows } = await query(
    `UPDATE jobs SET assigned_vet_id = $1, status = 'assigned',
       dispatch_state = 'accepted', dispatch_offered_vet_id = $1, dispatch_expires_at = NULL,
       updated_at = now()
     WHERE id = $2 RETURNING *`,
    [vetId, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });

  await logAction({ actorUserId: req.user.sub, action: 'job_manually_assigned', targetType: 'job', targetId: req.params.id, metadata: { vetId } });
  res.json({ job: rows[0] });
});

// Vet accepts an offer made to them.
router.post('/:id/dispatch/accept', requireAuth, requireRole('vet'), async (req, res) => {
  const { rows: vetRows } = await query('SELECT id FROM vets WHERE user_id = $1', [req.user.sub]);
  const vet = vetRows[0];
  if (!vet) return res.status(403).json({ error: 'Not a vet account' });

  const { rows } = await query(
    `UPDATE jobs SET assigned_vet_id = $1, status = 'assigned', dispatch_state = 'accepted', dispatch_expires_at = NULL, updated_at = now()
     WHERE id = $2 AND dispatch_offered_vet_id = $1 AND dispatch_state = 'offered'
     RETURNING *`,
    [vet.id, req.params.id]
  );
  if (!rows[0]) return res.status(409).json({ error: 'This offer is no longer available to you' });

  await logAction({ actorUserId: req.user.sub, action: 'dispatch_accepted', targetType: 'job', targetId: req.params.id });
  res.json({ job: rows[0] });
});

// Vet declines — rolls to the next best match immediately.
router.post('/:id/dispatch/decline', requireAuth, requireRole('vet'), async (req, res) => {
  const { rows: vetRows } = await query('SELECT id FROM vets WHERE user_id = $1', [req.user.sub]);
  const vet = vetRows[0];
  if (!vet) return res.status(403).json({ error: 'Not a vet account' });

  const { rows } = await query(
    `UPDATE jobs SET dispatch_declined_vet_ids = array_append(dispatch_declined_vet_ids, $1), updated_at = now()
     WHERE id = $2 AND dispatch_offered_vet_id = $1 AND dispatch_state = 'offered'
     RETURNING id`,
    [vet.id, req.params.id]
  );
  if (!rows[0]) return res.status(409).json({ error: 'This offer is no longer available to you' });

  await logAction({ actorUserId: req.user.sub, action: 'dispatch_declined', targetType: 'job', targetId: req.params.id });
  const dispatch = await startOrRollDispatch(req.params.id);
  res.json({ dispatch });
});

// One-tap status advance (available -> assigned -> in_route -> started -> completed),
// plus cancellation as a side-door from any state.
const STATUS_FLOW = ['available', 'assigned', 'in_route', 'started', 'completed'];
router.post('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  if (status === 'cancelled') {
    const { rows } = await query(`UPDATE jobs SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
    await logAction({ actorUserId: req.user.sub, action: 'job_cancelled', targetType: 'job', targetId: req.params.id });
    return res.json({ job: rows[0] });
  }
  if (!STATUS_FLOW.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const { rows } = await query(`UPDATE jobs SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`, [status, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });

  await logAction({ actorUserId: req.user.sub, action: 'job_status_changed', targetType: 'job', targetId: req.params.id, metadata: { status } });
  res.json({ job: rows[0] });
});

// Task-gated completion — every condition below must hold before a job
// can move to 'completed'. This is the brief's explicit business rule.
router.post('/:id/complete', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const missing = [];
  if (!job.assigned_vet_id) missing.push('vet assigned');
  if (!job.consent_signed) missing.push('consent signed');
  if (job.payment_status !== 'paid') missing.push('payment received');
  if (!job.procedure_done) missing.push('procedure performed');
  if (job.service_type !== 'euthanasia_only' && !job.cremation_booked) missing.push('cremation booked with partner');

  if (missing.length > 0) {
    return res.status(409).json({ error: 'Job cannot be marked complete yet', missing });
  }

  const { rows: updated } = await query(`UPDATE jobs SET status = 'completed', updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
  await logAction({ actorUserId: req.user.sub, action: 'job_completed', targetType: 'job', targetId: req.params.id });
  res.json({ job: updated[0] });
});

// Task-gate field updates — separate small endpoints rather than one
// giant PATCH, so each action logs clearly in the audit trail.
router.post('/:id/consent-signed', requireAuth, async (req, res) => {
  const { rows } = await query(`UPDATE jobs SET consent_signed = true, updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: rows[0] });
});

router.post('/:id/payment-received', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await query(`UPDATE jobs SET payment_status = 'paid', updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  await logAction({ actorUserId: req.user.sub, action: 'payment_recorded', targetType: 'job', targetId: req.params.id });
  res.json({ job: rows[0] });
});

router.post('/:id/procedure-done', requireAuth, requireRole('vet'), async (req, res) => {
  const { rows } = await query(`UPDATE jobs SET procedure_done = true, procedure_done_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: rows[0] });
});

router.post('/:id/cremation-booked', requireAuth, requireRole('admin'), async (req, res) => {
  const { bookingRef } = req.body;
  const { rows } = await query(
    `UPDATE jobs SET cremation_booked = true, cremation_booking_ref = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [bookingRef || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  await logAction({ actorUserId: req.user.sub, action: 'cremation_booked', targetType: 'job', targetId: req.params.id });
  res.json({ job: rows[0] });
});

router.post('/:id/ashes-returned', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await query(`UPDATE jobs SET ashes_returned = true, updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: rows[0] });
});

// Per-job internal thread between admin and the assigned vet.
router.get('/:id/internal-messages', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT m.*, u.full_name AS sender_name FROM job_internal_messages m JOIN users u ON u.id = m.sender_user_id WHERE m.job_id = $1 ORDER BY m.created_at`,
    [req.params.id]
  );
  res.json({ messages: rows });
});

router.post('/:id/internal-messages', requireAuth, async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message body required' });

  const { rows } = await query(
    `INSERT INTO job_internal_messages (job_id, sender_user_id, body) VALUES ($1, $2, $3) RETURNING *`,
    [req.params.id, req.user.sub, body.trim()]
  );
  res.status(201).json({ message: rows[0] });
});

export { startOrRollDispatch };
export default router;
