import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logAction } from '../audit/log.js';
import { notifyAdmins } from '../notifications/notify.js';
import { suggestTimeCategory } from '../domain/pricing.js';
// Reused rather than reimplemented, so a converted request dispatches
// and links exactly like any other booking.
import { startOrRollDispatch, sendJourneyLink } from './jobs.js';
import { sendSlackMessage } from '../integrations/slack/webhook.js';
import { sendEmail, isEmailConfigured } from '../integrations/email/smtp.js';

const router = Router();

/**
 * Map the free-text service preference from the public form onto a real
 * service type. Returns null when it can't be determined, so admin is
 * asked rather than guessed at — a wrong service type changes both the
 * price and whether ashes come back.
 */
export function guessServiceType(preference) {
  const p = (preference || '').toLowerCase();
  if (!p) return null;
  if (p.includes('private')) return 'private_cremation';
  if (p.includes('communal')) return 'communal_cremation';
  if (p.includes('euthanasia only')) return 'euthanasia_only';
  return null; // "I'm not sure yet" and anything unrecognised
}


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


/**
 * GET /booking-requests/form-content — public.
 *
 * The form needs its own wording before anyone has logged in, so this is
 * unauthenticated. It returns ONLY the requestForm block plus the
 * company name — never the whole content config, which also holds
 * consent templates, brochure copy and the RCTI declaration that have no
 * business being readable by the public.
 */
router.get('/form-content', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT config FROM content_settings WHERE id = true');
  const config = rows[0]?.config || {};
  res.json({
    content: config.requestForm || null,
    companyName: config.company?.name || 'Goodbye Mate',
    companyPhone: config.company?.phone || null,
  });
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


const convertSchema = z.object({
  // The three things a human must confirm — everything else can carry
  // over from the request as-is.
  address: z.string().trim().min(1, 'Confirm the address.'),
  serviceType: z.enum(['euthanasia_only', 'private_cremation', 'communal_cremation']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Choose a time.'),

  postcode: z.string().trim().min(1, 'A postcode is needed for territory matching.'),
  state: z.string().trim().min(1),
  suburb: z.string().trim().optional().nullable(),
  petName: z.string().trim().min(1, 'The pet needs a name on the booking.'),
  petType: z.string().trim().min(1),
  petBreed: z.string().trim().optional().nullable(),
  petWeight: z.string().trim().optional().nullable(),
  petAge: z.string().trim().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  notes: z.string().trim().optional().nullable(),

  /**
   * Whether to start auto-dispatch immediately.
   *
   * Defaults TRUE — the point of this screen is one-tap approve and
   * dispatch — but admin can turn it off to create the booking without
   * offering it yet (e.g. the client is still deciding on a time).
   */
  dispatch: z.boolean().optional().default(true),
});

/**
 * POST /booking-requests/:id/convert
 *
 * Turn a request into a real job, then optionally dispatch it.
 *
 * Deliberately NOT automatic on submission: a public request has an
 * unverified address, often no weight, and frequently no firm service
 * type. Offering that to vets means offering a job whose location and
 * payout aren't actually known, for something the client hasn't yet
 * agreed to. This endpoint is the human confirmation step — it just
 * removes the re-keying, rather than removing the check.
 */
router.post('/:id/convert', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = convertSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Please check the details.' });
  }
  const d = parsed.data;

  const { rows: reqRows } = await query('SELECT * FROM booking_requests WHERE id = $1', [req.params.id]);
  const request = reqRows[0];
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.converted_job_id) {
    return res.status(409).json({ error: 'This request has already been turned into a booking.' });
  }

  const timeCategory = suggestTimeCategory(d.date, d.time);

  const { rows: jobRows } = await query(
    `INSERT INTO jobs (
       client_name, client_phone, client_email, address, suburb, postcode, state, lat, lng,
       pet_name, pet_type, pet_breed, pet_weight, pet_age,
       service_id, service_type, job_date, job_time, time_category, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'svc_euth',$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      request.client_name, request.client_phone, request.client_email,
      d.address, d.suburb || null, d.postcode, d.state, d.lat ?? null, d.lng ?? null,
      d.petName, d.petType, d.petBreed || null, d.petWeight || null, d.petAge || null,
      d.serviceType, d.date, d.time, timeCategory,
      // Carry the client's own words onto the job — context a vet
      // genuinely benefits from, and it would otherwise be stranded on
      // the request record.
      [request.message, d.notes].filter(Boolean).join('\n\n') || null,
    ]
  );
  const job = jobRows[0];

  await query(
    `UPDATE booking_requests
     SET status = 'converted', converted_job_id = $1, handled_by = $2, handled_at = now()
     WHERE id = $3`,
    [job.id, req.user.sub, req.params.id]
  );

  await logAction({
    actorUserId: req.user.sub,
    action: 'booking_request_converted',
    targetType: 'booking_request',
    targetId: req.params.id,
    metadata: { jobId: job.id, dispatched: d.dispatch },
  });

  // Send the client their journey link exactly as a normal booking does.
  sendJourneyLink(job).catch((e) => console.error('journey link failed:', e.message));

  let dispatch = null;
  if (d.dispatch) {
    // Failing to dispatch must not lose the job that was just created —
    // it's already saved, and admin can offer it manually.
    try {
      dispatch = await startOrRollDispatch(job.id);
    } catch (err) {
      console.error('dispatch after convert failed:', err.message);
      dispatch = { state: 'error', message: err.message };
    }
  }

  res.status(201).json({ job, dispatch });
}));

export default router;
