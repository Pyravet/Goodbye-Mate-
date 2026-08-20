import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logAction } from '../audit/log.js';
import { notifyAdmins } from '../notifications/notify.js';
import { sendSlackMessage } from '../integrations/slack/webhook.js';
import { sendEmail, isEmailConfigured } from '../integrations/email/smtp.js';

const router = Router();

/**
 * Tight limit on the PUBLIC endpoint.
 *
 * This is the only route in the system an anonymous person can write to,
 * so it's the obvious target for spam. A genuine person books once,
 * maybe twice if they mistype something — five per hour per IP is
 * generous for real use and useless for flooding.
 */
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this connection. Please call us instead.' },
});

const submitSchema = z.object({
  clientName: z.string().trim().min(1, 'Please tell us your name.').max(120),
  clientPhone: z.string().trim().min(6, 'Please give us a phone number we can reach you on.').max(40),
  clientEmail: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().email('That email address doesn\u2019t look right.').nullable().optional()
  ),
  address: z.string().trim().max(300).optional().nullable(),
  suburb: z.string().trim().max(120).optional().nullable(),
  postcode: z.string().trim().max(10).optional().nullable(),
  state: z.string().trim().max(10).optional().nullable(),
  petName: z.string().trim().max(120).optional().nullable(),
  petType: z.string().trim().max(60).optional().nullable(),
  petBreed: z.string().trim().max(120).optional().nullable(),
  petWeight: z.string().trim().max(60).optional().nullable(),
  petAge: z.string().trim().max(60).optional().nullable(),
  servicePreference: z.string().trim().max(120).optional().nullable(),
  preferredTiming: z.string().trim().max(200).optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),

  /**
   * Honeypot. Hidden from real users with CSS, so a human never fills it
   * in; most naive bots fill every field they find. Chosen over a CAPTCHA
   * deliberately — this form is used by people who have just decided to
   * put their pet down, and making them decode distorted text at that
   * moment would be cruel and would cost real bookings.
   */
  website: z.string().max(0).optional().nullable(),
});

/**
 * POST /public/booking-requests — the public form.
 *
 * Creates a REQUEST, never a job. Nothing here touches dispatch, so a
 * malicious submission can't notify vets or occupy the board.
 */
router.post('/', submitLimiter, asyncHandler(async (req, res) => {
  const parsed = submitSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Please check the form and try again.' });
  }
  const d = parsed.data;

  // Honeypot filled = almost certainly a bot. Stored as 'spam' rather
  // than rejected outright, so a false positive is recoverable and
  // visible instead of silently lost — and the bot gets a normal-looking
  // success response rather than a signal to retry differently.
  const isSpam = typeof d.website === 'string' && d.website.length > 0;

  const { rows } = await query(
    `INSERT INTO booking_requests
       (client_name, client_phone, client_email, address, suburb, postcode, state,
        pet_name, pet_type, pet_breed, pet_weight, pet_age,
        service_preference, preferred_timing, message, status, submitted_ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id, created_at`,
    [
      d.clientName, d.clientPhone, d.clientEmail || null,
      d.address || null, d.suburb || null, d.postcode || null, d.state || null,
      d.petName || null, d.petType || null, d.petBreed || null, d.petWeight || null, d.petAge || null,
      d.servicePreference || null, d.preferredTiming || null, d.message || null,
      isSpam ? 'spam' : 'new',
      req.ip || null, (req.headers['user-agent'] || '').slice(0, 300),
    ]
  );

  if (!isSpam) {
    // Someone is likely distressed and waiting, so this is the one place
    // an immediate admin alert genuinely matters.
    notifyAdmins({
      title: 'New booking request',
      body: `${d.clientName} — ${d.petName || 'pet'}${d.suburb ? ` in ${d.suburb}` : ''}. ${d.clientPhone}`,
      url: '/requests',
      category: 'booking_request',
    }).catch((e) => console.error('booking request notify failed:', e.message));

    sendSlackMessage(
      `🆕 Booking request from ${d.clientName} (${d.clientPhone})`
      + `${d.petName ? ` — ${d.petName}` : ''}${d.suburb ? `, ${d.suburb}` : ''}`
      + `${d.preferredTiming ? `\nWhen: ${d.preferredTiming}` : ''}`
    ).catch((e) => console.error('slack notify failed:', e.message));

    // Acknowledge to the client so they aren't left wondering whether it
    // sent. Best-effort: a mail failure must not fail their submission.
    if (d.clientEmail && isEmailConfigured()) {
      sendEmail({
        to: d.clientEmail,
        subject: 'We\u2019ve received your request — Goodbye Mate',
        html: `<p>Hi ${d.clientName},</p>`
          + `<p>Thank you for reaching out. We\u2019ve received your request`
          + `${d.petName ? ` for ${d.petName}` : ''} and someone will call you shortly on ${d.clientPhone}.</p>`
          + `<p>If it\u2019s urgent, please call us directly.</p>`
          + `<p>— Goodbye Mate</p>`,
      }).catch((e) => console.error('ack email failed:', e.message));
    }
  }

  // Identical response either way: a bot shouldn't learn it was caught.
  res.status(201).json({ ok: true, id: rows[0].id });
}));

// --- Admin ---

router.get('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const status = req.query.status;
  const params = [];
  let where = "WHERE status <> 'spam'";
  if (status && status !== 'all') {
    params.push(status);
    where = `WHERE status = $1`;
  } else if (status === 'all') {
    where = '';
  }

  const { rows } = await query(
    `SELECT id, client_name, client_phone, client_email, address, suburb, postcode, state,
            pet_name, pet_type, pet_breed, pet_weight, pet_age,
            service_preference, preferred_timing, message, status,
            converted_job_id, admin_notes, created_at
     FROM booking_requests ${where}
     ORDER BY (status = 'new') DESC, created_at DESC
     LIMIT 200`,
    params
  );
  res.json({ requests: rows });
}));

/** Count of unhandled requests — powers the nav badge. */
router.get('/new-count', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM booking_requests WHERE status = 'new'");
  res.json({ count: rows[0].count });
}));

const updateSchema = z.object({
  status: z.enum(['new', 'contacted', 'converted', 'declined', 'spam']).optional(),
  adminNotes: z.string().trim().max(2000).optional().nullable(),
});

router.put('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = updateSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid update' });

  const { rows } = await query(
    `UPDATE booking_requests
     SET status = COALESCE($1, status),
         admin_notes = COALESCE($2, admin_notes),
         handled_by = $3,
         handled_at = now()
     WHERE id = $4 RETURNING *`,
    [parsed.data.status || null, parsed.data.adminNotes ?? null, req.user.sub, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Request not found' });

  await logAction({
    actorUserId: req.user.sub,
    action: 'booking_request_updated',
    targetType: 'booking_request',
    targetId: req.params.id,
    metadata: { status: parsed.data.status },
  });

  res.json({ request: rows[0] });
}));

/**
 * Mark a request as converted, linking it to the job admin created.
 *
 * Deliberately NOT an automatic "create the job from this request":
 * every real booking needs a confirmed date, time, service and address,
 * and those are settled on the phone. Auto-creating from unverified
 * free text would put junk on the dispatch board. Admin creates the job
 * through the normal form and links it here.
 */
router.post('/:id/converted', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const jobId = req.body?.jobId;
  if (!jobId) return res.status(400).json({ error: 'jobId is required' });

  const { rows: jobRows } = await query('SELECT id FROM jobs WHERE id = $1', [jobId]);
  if (!jobRows[0]) return res.status(400).json({ error: 'That job does not exist.' });

  const { rows } = await query(
    `UPDATE booking_requests
     SET status = 'converted', converted_job_id = $1, handled_by = $2, handled_at = now()
     WHERE id = $3 AND status <> 'converted'
     RETURNING *`,
    [jobId, req.user.sub, req.params.id]
  );
  if (!rows[0]) return res.status(409).json({ error: 'Request not found, or already converted.' });

  await logAction({
    actorUserId: req.user.sub,
    action: 'booking_request_converted',
    targetType: 'booking_request',
    targetId: req.params.id,
    metadata: { jobId },
  });

  res.json({ request: rows[0] });
}));

export default router;
