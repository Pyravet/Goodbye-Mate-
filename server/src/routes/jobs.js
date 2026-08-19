import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAction } from '../audit/log.js';
import { billBreakdown, payoutBreakdown, suggestTimeCategory, extractGst } from '../domain/pricing.js';
import { rankVets, DISPATCH_TIMEOUT_MS } from '../domain/dispatch.js';
import { getVetsWithContextForJob, getVetIdForUser } from '../domain/vetContext.js';
import { sendPushToUser, sendPushToAdmins } from '../integrations/push/webPush.js';
import { getDrivingEta } from '../integrations/maps/distanceMatrix.js';
import { sendSlackMessage } from '../integrations/slack/webhook.js';
import { sendExpoPushToUser } from '../integrations/push/expoPush.js';
import { generateRctiPdf, generateRctiPdfBuffer, rctiFilename } from '../pdf/generateRcti.js';
import { generateVetRecordPdf, generateVetRecordPdfBuffer, vetRecordFilename } from '../pdf/generateVetRecord.js';
import { generateInvoicePdf, generateInvoicePdfBuffer, invoiceFilename } from '../pdf/generateInvoice.js';
import { chargeCard, isEwayConfigured } from '../integrations/payments/eway.js';
import { sendEmail, isEmailConfigured } from '../integrations/email/smtp.js';
import { sendTemplatedSms, isMsg91Configured } from '../integrations/sms/msg91.js';
import { isTemplateConfigured } from '../integrations/sms/templates.js';
import { sendWhatsappTemplate, isWhatsappConfigured } from '../integrations/whatsapp/msg91Whatsapp.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

// The business operates in Australia; all "today"/"upcoming"/"past"
// reasoning must use local dates rather than the database server's UTC
// clock. A named IANA zone (not a fixed offset) so daylight saving is
// handled automatically.
// NOTE: this is a hardcoded literal interpolated into SQL — safe because
// it is a constant defined here, never user input.
const BUSINESS_TZ = 'Australia/Melbourne';

// Shared formatting for the *_day/*_date/*_time SMS template variables.
function smsDateVars(job) {
  const d = new Date(`${job.job_date instanceof Date ? job.job_date.toISOString().slice(0, 10) : job.job_date}T${job.job_time}`);
  return {
    book_day: d.toLocaleDateString('en-AU', { weekday: 'long' }),
    book_date: d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long' }),
    book_time: job.job_time,
    book_address: job.address,
  };
}

const router = Router();

// Every route below sends an outbound message (SMS, WhatsApp, email, or a
// push) that costs money or could be used to spam a client if abused —
// e.g. by rapidly re-triggering "send quote" or "I'm on the way". This is
// deliberately tighter than the blanket /api limit in index.js.
const outboundMessageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages sent in a short period. Try again shortly.' },
});

const createJobSchema = z.object({
  clientName: z.string().min(1),
  clientPhone: z.string().min(1),
  // Email is genuinely optional. Accept '' (what an untouched form field
  // sends) and normalise it to null — previously a blank email failed
  // .email() validation and silently rejected the entire booking.
  clientEmail: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().email().nullable().optional()
  ),
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
  date: z.string().min(1), // YYYY-MM-DD
  time: z.string().min(1), // HH:MM
  extraTravelFee: z.number().optional().default(0),
  isPublicHoliday: z.boolean().optional().default(false),
  notes: z.string().optional(),
});

// Line items (extra charges + discounts) for a job. Every bill/payout
// calculation must include these or the client is quoted one figure and
// invoiced another — so this is fetched everywhere billBreakdown is used.
async function getLineItems(jobId) {
  const { rows } = await query(
    'SELECT label, amount, vet_payout FROM job_line_items WHERE job_id = $1 ORDER BY created_at',
    [jobId]
  );
  return rows;
}

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

    // Notify the vet on their phone — this is the actual moment a job
    // offer needs to reach someone in the field, not just sit in a list.
    const { rows: vetUserRows } = await query(
      `SELECT u.id AS user_id FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
      [next.vetId]
    );
    if (vetUserRows[0]) {
      const pushPayload = {
        title: 'New job offer',
        body: `${job.pet_name} in ${job.suburb || job.postcode} — respond soon, this offer expires.`,
        url: `/jobs/${jobId}`,
      };
      sendPushToUser(vetUserRows[0].user_id, pushPayload).catch((err) => console.error('Web push failed:', err));
      sendExpoPushToUser(vetUserRows[0].user_id, pushPayload).catch((err) => console.error('Expo push failed:', err));
    }

    return { state: 'offered', offeredVetId: next.vetId, expiresAt };
  } else {
    await query(
      `UPDATE jobs SET dispatch_state = 'unassigned', dispatch_offered_vet_id = NULL, dispatch_expires_at = NULL, updated_at = now() WHERE id = $1`,
      [jobId]
    );
    return { state: 'unassigned' };
  }
}

router.post('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) {
    // Surface WHICH field failed rather than a bare "Invalid job" — an
    // opaque error here made a blank optional email look like a total
    // system failure with no way to tell what to fix.
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const summary = Object.entries(fieldErrors)
      .map(([field, msgs]) => `${field}: ${msgs?.[0] || 'invalid'}`)
      .join('; ');
    return res.status(400).json({
      error: summary ? `Please check these fields — ${summary}` : 'Invalid job',
      details: parsed.error.flatten(),
    });
  }
  const d = parsed.data;

  const timeCategory = suggestTimeCategory(d.date, d.time);

  const { rows } = await query(
    `INSERT INTO jobs (
      client_name, client_phone, client_email, address, suburb, postcode, state, lat, lng,
      pet_name, pet_type, pet_breed, pet_weight, pet_age, pet_behaviour,
      service_id, service_type, job_date, job_time, time_category, extra_travel_fee, notes, is_public_holiday
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    RETURNING *`,
    [
      d.clientName, d.clientPhone, d.clientEmail || null, d.address, d.suburb || null, d.postcode, d.state, d.lat ?? null, d.lng ?? null,
      d.petName, d.petType, d.petBreed || null, d.petWeight || null, d.petAge || null, d.petBehaviour || 'Friendly',
      d.serviceId, d.serviceType, d.date, d.time, timeCategory, d.extraTravelFee || 0, d.notes || null, d.isPublicHoliday || false,
    ]
  );
  const job = rows[0];

  await logAction({ actorUserId: req.user.sub, action: 'job_created', targetType: 'job', targetId: job.id, metadata: { jobNumber: job.job_number } });

  if (isMsg91Configured() && isTemplateConfigured('bookingReceived')) {
    sendTemplatedSms(job.client_phone, 'bookingReceived', {
      client_name: job.client_name,
      pet_name: job.pet_name,
      ...smsDateVars(job),
    }).catch((err) => console.error('Booking-received SMS failed:', err.message));
  }

  sendJourneyLink(job).catch((err) => console.error('Journey link send failed:', err.message));

  // Kick off auto-dispatch immediately.
  const dispatch = await startOrRollDispatch(job.id);

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const bill = billBreakdown(job, pricingRows[0].config, await getLineItems(job.id));

  res.status(201).json({ job, dispatch, bill });
}));

// Today / Upcoming / Past / Board (all) — the four admin views from the brief.
// For vets, results are automatically restricted to their own offers and
// assignments — a vet has no reason to see other vets' jobs, and the admin
// board view isn't available to them at all.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { view, search } = req.query;
  const conditions = [];
  const params = [];

  if (req.user.role === 'vet') {
    const myVetId = await getVetIdForUser(req.user.sub);
    if (!myVetId) return res.status(403).json({ error: 'Not a vet account' });
    params.push(myVetId);
    conditions.push(`(assigned_vet_id = $${params.length} OR (dispatch_offered_vet_id = $${params.length} AND dispatch_state = 'offered'))`);
  }

  // "Today" must mean today in AUSTRALIA, not on the database server.
  // CURRENT_DATE resolves in the server's timezone (UTC on Neon), so for
  // most of the Australian working day UTC is still on the PREVIOUS
  // date — a job booked for today sat in "Upcoming" until ~10am AEST.
  // BUSINESS_TZ centralises this so the three views can't drift apart.
  if (view === 'today') {
    conditions.push(`job_date = (now() AT TIME ZONE '${BUSINESS_TZ}')::date`);
  } else if (view === 'upcoming') {
    conditions.push(`job_date > (now() AT TIME ZONE '${BUSINESS_TZ}')::date AND status NOT IN ('completed','cancelled')`);
  } else if (view === 'past') {
    conditions.push(`(job_date < (now() AT TIME ZONE '${BUSINESS_TZ}')::date OR status IN ('completed','cancelled'))`);
  }
  // 'board' (or no view param) = everything the conditions above already allow.

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(client_name ILIKE $${params.length} OR pet_name ILIKE $${params.length} OR suburb ILIKE $${params.length} OR job_number ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM jobs ${where} ORDER BY job_date, job_time`, params);
  res.json({ jobs: rows });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });

  if (req.user.role === 'vet') {
    const myVetId = await getVetIdForUser(req.user.sub);
    const job = rows[0];
    const isMine = job.assigned_vet_id === myVetId || (job.dispatch_offered_vet_id === myVetId && job.dispatch_state === 'offered');
    if (!isMine) return res.status(403).json({ error: 'Forbidden' });
  }

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const pricing = pricingRows[0].config;
  const bill = billBreakdown(rows[0], pricing, await getLineItems(rows[0].id));
  const payout = payoutBreakdown(rows[0], pricing, await getLineItems(rows[0].id));

  res.json({ job: rows[0], bill, payout });
}));

// RCTI PDF — what the vet is owed for this job. Admin can view any job's
// RCTI; a vet can view their own once assigned.
router.get('/:id/rcti.pdf', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.assigned_vet_id) return res.status(400).json({ error: 'No vet assigned to this job yet' });

  if (req.user.role === 'vet') {
    const myVetId = await getVetIdForUser(req.user.sub);
    if (job.assigned_vet_id !== myVetId) return res.status(403).json({ error: 'Forbidden' });
  }

  const { rows: vetRows } = await query(
    `SELECT v.abn, v.is_gst_registered, v.reg_number, v.reg_state, u.full_name
     FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
    [job.assigned_vet_id]
  );
  const vet = vetRows[0];
  if (!vet) return res.status(404).json({ error: 'Assigned vet not found' });

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const { rows: contentRows } = await query('SELECT config FROM content_settings WHERE id = true');
  const pricing = pricingRows[0].config;
  const company = contentRows[0].config.company || {};

  const payout = payoutBreakdown(job, pricing, await getLineItems(job.id));
  const gst = vet.is_gst_registered ? extractGst(payout.total, pricing.gstPercent) : null;

  generateRctiPdf({ res, job, vet, payout, gst, company });
}));

// Client invoice/receipt/quote PDF — same document, labelled by intent.
// ?quote=1 produces a pre-booking quote (no payment status shown, softer
// wording) — the manual stopgap for "send a quote" until SMS/WhatsApp/
// Outlook auto-send is wired up with real credentials.
router.get('/:id/invoice.pdf', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const { rows: contentRows } = await query('SELECT config FROM content_settings WHERE id = true');
  const pricing = pricingRows[0].config;
  const company = contentRows[0].config.company || {};

  const bill = billBreakdown(job, pricing, await getLineItems(job.id));
  const asQuote = req.query.quote === '1';

  generateInvoicePdf({ res, job, bill, company, asQuote });
}));

// Charge the client's card via eWay — server never receives raw card
// digits, only the fields already encrypted in the browser by eCrypt.js.
// Builds the client-facing journey link. CLIENT_APP_URL should point at
// the deployed web-client app (care.goodbyemate.com.au once that's the
// custom domain); falls back to a placeholder so this never throws if
// the env var isn't set yet.
function journeyLink(job) {
  const base = process.env.CLIENT_APP_URL || 'https://care.goodbyemate.com.au';
  return `${base.replace(/\/$/, '')}/${job.client_token}`;
}

async function sendJourneyLink(job) {
  const link = journeyLink(job);
  const results = { email: null, sms: null };

  if (!job.client_email) {
    results.email = 'no email address on file';
  } else if (!isEmailConfigured()) {
    results.email = 'email is not configured on the server';
  } else {
    try {
      await sendEmail({
        to: job.client_email,
        subject: `Your visit with Goodbye Mate — ${job.pet_name}`,
        html: `<p>Hi ${job.client_name},</p><p>Here's your booking journey for ${job.pet_name} — process info, consent form, and payment, all in one place:</p><p><a href="${link}">${link}</a></p>`,
      });
      results.email = 'sent';
    } catch (err) {
      results.email = err.message;
    }
  }

  if (!job.client_phone) {
    results.sms = 'no phone number on file';
  } else if (!isMsg91Configured()) {
    results.sms = 'SMS is not configured on the server';
  } else if (!isTemplateConfigured('genericMessage')) {
    results.sms = 'no SMS template configured';
  } else {
    try {
      await sendTemplatedSms(job.client_phone, 'genericMessage', {
        message: `Hi ${job.client_name}, here's your Goodbye Mate booking journey for ${job.pet_name}: ${link}`,
      });
      results.sms = 'sent';
    } catch (err) {
      results.sms = err.message;
    }
  }

  if (results.email === 'sent' || results.sms === 'sent') {
    await query(`UPDATE jobs SET journey_link_sent_at = now() WHERE id = $1`, [job.id]);
  }

  return results;
}

const chargeSchema = z.object({
  encryptedCard: z.object({
    number: z.string().min(1),
    expiryMonth: z.string().min(1),
    expiryYear: z.string().min(1),
    cvn: z.string().min(1),
  }),
});

router.post('/:id/charge', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  if (!isEwayConfigured()) {
    return res.status(503).json({ error: 'Payment processing is not configured yet.' });
  }

  const parsed = chargeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid card details', details: parsed.error.flatten() });

  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.payment_status === 'paid') return res.status(409).json({ error: 'This job is already marked paid.' });

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const pricing = pricingRows[0].config;
  const bill = billBreakdown(job, pricing, await getLineItems(job.id));

  const result = await chargeCard({
    amountDollars: bill.total,
    invoiceReference: job.job_number,
    customerName: job.client_name,
    encryptedCard: parsed.data.encryptedCard,
  });

  await query(
    `INSERT INTO payments (job_id, amount, provider, provider_transaction_id, status, response_message, processed_by_user_id)
     VALUES ($1,$2,'eway',$3,$4,$5,$6)`,
    [job.id, bill.total, result.transactionId, result.success ? 'succeeded' : 'failed', result.responseMessage, req.user.sub]
  );

  if (!result.success) {
    await logAction({ actorUserId: req.user.sub, action: 'payment_failed', targetType: 'job', targetId: job.id, metadata: { responseMessage: result.responseMessage } });
    return res.status(402).json({ error: 'Payment declined', message: result.responseMessage });
  }

  const { rows: updated } = await query(
    `UPDATE jobs SET payment_status = 'paid', payment_reference = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [result.transactionId, job.id]
  );
  await logAction({ actorUserId: req.user.sub, action: 'payment_succeeded', targetType: 'job', targetId: job.id, metadata: { transactionId: result.transactionId, amount: bill.total } });

  res.json({ ok: true, job: updated[0], transactionId: result.transactionId, amount: bill.total });
}));

// Emails a quote, invoice, or RCTI as a PDF attachment — the automated
// version of the "download and send manually" stopgap.
router.post('/:id/email-document', outboundMessageLimiter, requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  if (!isEmailConfigured()) return res.status(503).json({ error: 'Email is not configured yet.' });

  const type = req.body?.type; // 'quote' | 'invoice' | 'rcti'
  if (!['quote', 'invoice', 'rcti'].includes(type)) return res.status(400).json({ error: 'Invalid document type' });

  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const { rows: contentRows } = await query('SELECT config FROM content_settings WHERE id = true');
  const pricing = pricingRows[0].config;
  const company = contentRows[0].config.company || {};

  try {
    if (type === 'rcti') {
      if (!job.assigned_vet_id) return res.status(400).json({ error: 'No vet assigned to this job yet' });
      const { rows: vetRows } = await query(
        `SELECT v.abn, v.is_gst_registered, v.reg_number, v.reg_state, u.full_name, u.email
         FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
        [job.assigned_vet_id]
      );
      const vet = vetRows[0];
      if (!vet) return res.status(404).json({ error: 'Assigned vet not found' });
      if (!vet.email) return res.status(400).json({ error: 'Vet has no email on file' });

      const payout = payoutBreakdown(job, pricing, await getLineItems(job.id));
      const gst = vet.is_gst_registered ? extractGst(payout.total, pricing.gstPercent) : null;
      const buffer = await generateRctiPdfBuffer({ job, vet, payout, gst, company });

      await sendEmail({
        to: vet.email,
        subject: `RCTI for ${job.job_number} — ${job.pet_name}`,
        text: `Hi ${vet.full_name},\n\nAttached is the RCTI for job ${job.job_number} (${job.pet_name}).\n\nThanks,\n${company.name || 'Goodbye Mate'}`,
        attachments: [{ filename: rctiFilename(job), content: buffer }],
      });
    } else {
      const asQuote = type === 'quote';
      if (!job.client_email) return res.status(400).json({ error: 'Client has no email on file for this job' });
      const bill = billBreakdown(job, pricing, await getLineItems(job.id));
      const buffer = await generateInvoicePdfBuffer({ job, bill, company, asQuote });

      await sendEmail({
        to: job.client_email,
        subject: `${asQuote ? 'Your quote' : 'Your invoice'} from ${company.name || 'Goodbye Mate'} — ${job.job_number}`,
        text: `Hi ${job.client_name},\n\nPlease find attached ${asQuote ? 'your quote' : 'your invoice'} for ${job.pet_name}.\n\nThanks,\n${company.name || 'Goodbye Mate'}`,
        attachments: [{ filename: invoiceFilename(job, asQuote), content: buffer }],
      });
    }

    await logAction({ actorUserId: req.user.sub, action: 'document_emailed', targetType: 'job', targetId: job.id, metadata: { type } });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: 'Failed to send email', message: err.message });
  }
}));

// Text the quote total to the client via SMS — same passthrough template
// used for AI-drafted messages, since this is also free text (not one of
// the fixed structured templates like bookingReceived).
router.post('/:id/sms-quote', outboundMessageLimiter, requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  if (!isMsg91Configured()) return res.status(503).json({ error: 'SMS is not configured yet.' });
  if (!isTemplateConfigured('genericMessage')) return res.status(503).json({ error: 'No SMS passthrough template configured yet.' });

  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.client_phone) return res.status(400).json({ error: 'Client has no phone number on file for this job' });

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const bill = billBreakdown(job, pricingRows[0].config, await getLineItems(job.id));

  const message = `Hi ${job.client_name}, your quote for ${job.pet_name} is $${bill.total.toFixed(2)}. We've also sent a detailed quote to your email if provided.`;

  try {
    await sendTemplatedSms(job.client_phone, 'genericMessage', { message });
    await logAction({ actorUserId: req.user.sub, action: 'document_texted', targetType: 'job', targetId: job.id, metadata: { type: 'quote' } });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: 'Failed to send SMS', message: err.message });
  }
}));

router.post('/:id/send-journey-link', outboundMessageLimiter, requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const results = await sendJourneyLink(job);
  await logAction({ actorUserId: req.user.sub, action: 'journey_link_sent', targetType: 'job', targetId: job.id, metadata: results });
  res.json({ ok: true, link: journeyLink(job), ...results });
}));

router.post('/:id/whatsapp-quote', outboundMessageLimiter, requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  if (!isWhatsappConfigured()) return res.status(503).json({ error: 'WhatsApp is not configured yet.' });

  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.client_phone) return res.status(400).json({ error: 'Client has no phone number on file for this job' });

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const bill = billBreakdown(job, pricingRows[0].config, await getLineItems(job.id));

  try {
    await sendWhatsappTemplate(job.client_phone, [job.client_name, job.pet_name, `$${bill.total.toFixed(2)}`]);
    await logAction({ actorUserId: req.user.sub, action: 'document_whatsapped', targetType: 'job', targetId: job.id, metadata: { type: 'quote' } });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: 'Failed to send WhatsApp message', message: err.message });
  }
}));

// At-risk alerts: unassigned-soon, unpaid, unsigned consent,
// cremation-not-booked-after-completion. Computed on demand rather than
// stored — matches the prototype's computeAlerts exactly.
router.get('/alerts/list', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
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
}));

// Consolidated inbox: the latest internal message per job that has any,
// most recent first, so admin doesn't have to open every job to check
// for a new vet message. Vets get the equivalent via the unread dot on
// their own job list — this is admin's version of that at a glance.
router.get('/messages/inbox', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT DISTINCT ON (j.id)
      j.id AS job_id, j.job_number, j.pet_name, j.client_name, j.admin_unread_messages,
      m.body AS last_message, m.created_at AS last_message_at, u.full_name AS last_sender_name
    FROM jobs j
    JOIN job_internal_messages m ON m.job_id = j.id
    JOIN users u ON u.id = m.sender_user_id
    ORDER BY j.id, m.created_at DESC
  `);
  rows.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
  res.json({ threads: rows });
}));

// Manual assignment — either from the ranked list or the "assign any
// other vet" escape hatch for vets travelling outside their territory.
// --- Veterinary record (medical notes as a formal document) ---

/**
 * Load everything the record PDF needs: the job, the attending vet's
 * registration details, and company details.
 */
async function loadRecordContext(jobId) {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job) return null;

  let vet = {};
  if (job.assigned_vet_id) {
    const { rows: vetRows } = await query(
      `SELECT u.full_name, v.abn, v.reg_number, v.reg_state
       FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
      [job.assigned_vet_id]
    );
    vet = vetRows[0] || {};
  }

  const { rows: contentRows } = await query('SELECT config FROM content_settings WHERE id = true');
  return { job, vet, company: contentRows[0].config.company || {} };
}

/**
 * Both admin and the assigned vet may access the record — the vet wrote
 * the notes, and admin fields the insurer requests.
 */
async function canAccessRecord(req, job) {
  if (req.user.role === 'admin') return true;
  const myVetId = await getVetIdForUser(req.user.sub);
  return !!myVetId && job.assigned_vet_id === myVetId;
}

router.get('/:id/vet-record.pdf', requireAuth, asyncHandler(async (req, res) => {
  const ctx = await loadRecordContext(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Job not found' });
  if (!(await canAccessRecord(req, ctx.job))) return res.status(403).json({ error: 'Not your job' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${vetRecordFilename(ctx.job)}"`);
  generateVetRecordPdf({ res, ...ctx });
}));

const emailRecordSchema = z.object({
  // Defaults to the client's own address, but insurers and other vets
  // often need it sent somewhere else entirely.
  to: z.string().email('Enter a valid email address').optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),
});

router.post('/:id/email-vet-record', outboundMessageLimiter, requireAuth, asyncHandler(async (req, res) => {
  const parsed = emailRecordSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid request' });
  }

  const ctx = await loadRecordContext(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Job not found' });
  if (!(await canAccessRecord(req, ctx.job))) return res.status(403).json({ error: 'Not your job' });

  const to = parsed.data.to || ctx.job.client_email;
  if (!to) {
    return res.status(400).json({ error: 'No email address given, and this booking has no client email on file.' });
  }
  if (!isEmailConfigured()) {
    return res.status(503).json({ error: 'Email is not configured on the server.' });
  }

  const pdf = await generateVetRecordPdfBuffer(ctx);
  const note = parsed.data.message?.trim();

  await sendEmail({
    to,
    subject: `Veterinary record — ${ctx.job.pet_name} (${ctx.job.job_number})`,
    html: `<p>Hello,</p>`
      + `<p>Please find attached the veterinary record for ${ctx.job.pet_name}'s visit on `
      + `${new Date(ctx.job.job_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>`
      + (note ? `<p>${note.replace(/</g, '&lt;')}</p>` : '')
      + `<p>${ctx.company.name || 'Goodbye Mate'}</p>`,
    attachments: [{ filename: vetRecordFilename(ctx.job), content: pdf }],
  });

  await logAction({
    actorUserId: req.user.sub,
    action: 'vet_record_emailed',
    targetType: 'job',
    targetId: req.params.id,
    metadata: { to },
  });

  res.json({ ok: true, to });
}));

// --- Notify both sides when a job's status changes ---
// Status changes were previously silent: a vet could have a job
// cancelled out from under them with no signal at all.
async function notifyStatusChange(job, newStatus, { actorRole, reason } = {}) {
  const label = {
    available: 'is back on the board and needs a vet',
    assigned: 'has been assigned',
    in_route: 'is now marked as on the way',
    started: 'has been started',
    completed: 'has been completed',
    cancelled: 'has been CANCELLED',
  }[newStatus] || `status changed to ${newStatus}`;

  const body = `${job.pet_name} (${job.job_number}) ${label}${reason ? ` — ${reason}` : ''}.`;

  // Notify the assigned vet, unless they're the one who triggered it.
  if (job.assigned_vet_id && actorRole !== 'vet') {
    const { rows } = await query(
      'SELECT u.id AS user_id, u.phone, u.full_name FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1',
      [job.assigned_vet_id]
    );
    const vet = rows[0];
    if (vet) {
      await sendPushToUser(vet.user_id, { title: 'Job update', body, url: `/jobs/${job.id}` })
        .catch((e) => console.error('status push failed:', e.message));
      await sendExpoPushToUser(vet.user_id, { title: 'Job update', body, url: `/jobs/${job.id}` })
        .catch((e) => console.error('status expo push failed:', e.message));
      // Cancellation is the one case worth an SMS — the vet may have
      // already set off, and a push alone can be missed while driving.
      if (newStatus === 'cancelled' && vet.phone && isMsg91Configured() && isTemplateConfigured('genericMessage')) {
        await sendTemplatedSms(vet.phone, 'genericMessage', { message: `Hi ${vet.full_name}, ${body}` })
          .catch((e) => console.error('status sms failed:', e.message));
      }
    }
  }

  // Notify admin, unless admin triggered it.
  if (actorRole !== 'admin') {
    await sendPushToAdmins({ title: 'Job update', body, url: `/jobs/${job.id}` })
      .catch((e) => console.error('status admin push failed:', e.message));
  }
  await sendSlackMessage(`📋 ${body}`).catch((e) => console.error('status slack failed:', e.message));
}

// --- Cancel a job ---
router.post('/:id/cancel', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const reason = (req.body?.reason || '').trim() || null;

  const { rows } = await query(
    `UPDATE jobs SET status = 'cancelled', cancelled_at = now(), cancellation_reason = $1,
       dispatch_state = 'none', dispatch_expires_at = NULL, updated_at = now()
     WHERE id = $2 AND status <> 'cancelled' RETURNING *`,
    [reason, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Job not found, or already cancelled.' });

  await logAction({ actorUserId: req.user.sub, action: 'job_cancelled', targetType: 'job', targetId: req.params.id, metadata: { reason } });
  notifyStatusChange(rows[0], 'cancelled', { actorRole: 'admin', reason })
    .catch((e) => console.error('cancel notify failed:', e.message));

  res.json({ job: rows[0] });
}));

// Reinstate a cancelled job — mistakes happen, and re-keying a whole
// booking to undo one is worse than an explicit un-cancel.
router.post('/:id/reinstate', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE jobs SET status = CASE WHEN assigned_vet_id IS NULL THEN 'available' ELSE 'assigned' END,
       cancelled_at = NULL, cancellation_reason = NULL, updated_at = now()
     WHERE id = $1 AND status = 'cancelled' RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Job not found, or not cancelled.' });

  await logAction({ actorUserId: req.user.sub, action: 'job_reinstated', targetType: 'job', targetId: req.params.id });
  notifyStatusChange(rows[0], rows[0].status, { actorRole: 'admin' })
    .catch((e) => console.error('reinstate notify failed:', e.message));

  res.json({ job: rows[0] });
}));

// --- Admin notes (visible to the assigned vet) ---
router.put('/:id/admin-notes', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';
  const { rows } = await query(
    'UPDATE jobs SET admin_notes = $1, updated_at = now() WHERE id = $2 RETURNING id, admin_notes, assigned_vet_id, pet_name, job_number',
    [notes.trim() || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });

  await logAction({ actorUserId: req.user.sub, action: 'admin_notes_updated', targetType: 'job', targetId: req.params.id });

  // Tell the vet there's a new instruction — a note nobody reads is
  // worse than no note, since admin assumes it landed.
  if (rows[0].assigned_vet_id && notes.trim()) {
    const { rows: vetRows } = await query(
      'SELECT u.id AS user_id FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1',
      [rows[0].assigned_vet_id]
    );
    if (vetRows[0]) {
      sendPushToUser(vetRows[0].user_id, {
        title: `Note added — ${rows[0].pet_name}`,
        body: notes.trim().slice(0, 120),
        url: `/jobs/${req.params.id}`,
      }).catch((e) => console.error('admin note push failed:', e.message));
    }
  }

  res.json({ ok: true, adminNotes: rows[0].admin_notes });
}));

// --- Line items: extra charges and discounts ---
const lineItemSchema = z.object({
  label: z.string().trim().min(1, 'Give the charge a label.'),
  amount: z.number().refine((n) => n !== 0, 'Amount cannot be zero.'),
  vetPayout: z.number().min(0).optional().default(0),
});

router.get('/:id/line-items', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT id, label, amount, vet_payout, created_at FROM job_line_items WHERE job_id = $1 ORDER BY created_at',
    [req.params.id]
  );
  res.json({ lineItems: rows });
}));

router.post('/:id/line-items', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = lineItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid line item' });
  }
  const { label, amount, vetPayout } = parsed.data;

  // A discount must not also pay the vet more — that would be a silent
  // margin leak rather than a discount.
  if (amount < 0 && vetPayout > 0) {
    return res.status(400).json({ error: 'A discount cannot also increase the vet payout.' });
  }

  const { rows } = await query(
    'INSERT INTO job_line_items (job_id, label, amount, vet_payout, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [req.params.id, label, amount, vetPayout, req.user.sub]
  );
  await logAction({ actorUserId: req.user.sub, action: amount < 0 ? 'discount_added' : 'extra_charge_added', targetType: 'job', targetId: req.params.id, metadata: { label, amount } });
  res.status(201).json({ id: rows[0].id });
}));

router.delete('/:id/line-items/:itemId', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await query('DELETE FROM job_line_items WHERE id = $1 AND job_id = $2', [req.params.itemId, req.params.id]);
  await logAction({ actorUserId: req.user.sub, action: 'line_item_removed', targetType: 'job', targetId: req.params.id });
  res.json({ ok: true });
}));

router.post('/:id/assign', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { vetId } = req.body;
  if (!vetId) return res.status(400).json({ error: 'vetId required' });

  // Capture who held the job first, so a reassignment can be cleanly
  // taken off their account and they can be told about it. Without this
  // the job silently vanished from the previous vet's list with no
  // notice — they could still be planning to attend.
  const { rows: beforeRows } = await query('SELECT assigned_vet_id FROM jobs WHERE id = $1', [req.params.id]);
  if (!beforeRows[0]) return res.status(404).json({ error: 'Job not found' });
  const previousVetId = beforeRows[0].assigned_vet_id;

  if (previousVetId === vetId) {
    return res.status(400).json({ error: 'That vet is already assigned to this job.' });
  }

  const { rows } = await query(
    `UPDATE jobs SET assigned_vet_id = $1, status = 'assigned',
       dispatch_state = 'accepted', dispatch_offered_vet_id = $1, dispatch_expires_at = NULL,
       en_route_at = NULL, en_route_eta_minutes = NULL, en_route_distance_text = NULL,
       updated_at = now()
     WHERE id = $2 RETURNING *`,
    [vetId, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  const job = rows[0];

  await logAction({
    actorUserId: req.user.sub,
    action: previousVetId ? 'job_reassigned' : 'job_manually_assigned',
    targetType: 'job',
    targetId: req.params.id,
    metadata: { vetId, previousVetId },
  });

  // Tell the vet who just lost the job. Fire-and-forget: a notification
  // failure must not roll back a completed reassignment.
  if (previousVetId) {
    (async () => {
      const { rows: prevRows } = await query(
        'SELECT u.id AS user_id, u.full_name, u.phone FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1',
        [previousVetId]
      );
      const prev = prevRows[0];
      if (!prev) return;

      const body = `${job.pet_name} on ${job.job_date} has been reassigned to another vet. It's been removed from your schedule.`;
      await sendPushToUser(prev.user_id, { title: 'Job reassigned', body, url: '/' }).catch((e) => console.error('reassign push failed:', e.message));
      await sendExpoPushToUser(prev.user_id, { title: 'Job reassigned', body, url: '/' }).catch((e) => console.error('reassign expo push failed:', e.message));
      if (prev.phone && isMsg91Configured() && isTemplateConfigured('genericMessage')) {
        await sendTemplatedSms(prev.phone, 'genericMessage', {
          message: `Hi ${prev.full_name}, ${body}`,
        }).catch((e) => console.error('reassign sms failed:', e.message));
      }
    })().catch((e) => console.error('reassign notify failed:', e.message));
  }

  res.json({ job });
}));

// Vet accepts an offer made to them.
router.post('/:id/dispatch/accept', requireAuth, requireRole('vet'), asyncHandler(async (req, res) => {
  const vetId = await getVetIdForUser(req.user.sub);
  if (!vetId) return res.status(403).json({ error: 'Not a vet account' });

  const { rows } = await query(
    `UPDATE jobs SET assigned_vet_id = $1, status = 'assigned', dispatch_state = 'accepted', dispatch_expires_at = NULL, updated_at = now()
     WHERE id = $2 AND dispatch_offered_vet_id = $1 AND dispatch_state = 'offered'
     RETURNING *`,
    [vetId, req.params.id]
  );
  if (!rows[0]) return res.status(409).json({ error: 'This offer is no longer available to you' });

  await logAction({ actorUserId: req.user.sub, action: 'dispatch_accepted', targetType: 'job', targetId: req.params.id });

  if (isMsg91Configured()) {
    const job = rows[0];
    const { rows: vetUserRows } = await query(
      `SELECT u.full_name, u.phone FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
      [vetId]
    );
    const vetUser = vetUserRows[0];
    const portalLink = `${process.env.VET_PORTAL_URL || 'https://goodbye-mate-vet-goodbye-mate.vercel.app'}/jobs/${job.id}`;

    if (vetUser?.phone && isTemplateConfigured('vetAssignedToVet')) {
      sendTemplatedSms(vetUser.phone, 'vetAssignedToVet', {
        vet_name: vetUser.full_name,
        pet_name: job.pet_name,
        link: portalLink,
        ...smsDateVars(job),
      }).catch((err) => console.error('Vet-assigned SMS (to vet) failed:', err.message));
    }
    if (isTemplateConfigured('clientVetAssignedGeneric')) {
      sendTemplatedSms(job.client_phone, 'clientVetAssignedGeneric', {}).catch(
        (err) => console.error('Vet-assigned SMS (to client) failed:', err.message)
      );
    }
  }

  res.json({ job: rows[0] });
}));

// Vet declines — rolls to the next best match immediately.
router.post('/:id/dispatch/decline', requireAuth, requireRole('vet'), asyncHandler(async (req, res) => {
  const vetId = await getVetIdForUser(req.user.sub);
  if (!vetId) return res.status(403).json({ error: 'Not a vet account' });

  const { rows } = await query(
    `UPDATE jobs SET dispatch_declined_vet_ids = array_append(dispatch_declined_vet_ids, $1), updated_at = now()
     WHERE id = $2 AND dispatch_offered_vet_id = $1 AND dispatch_state = 'offered'
     RETURNING id`,
    [vetId, req.params.id]
  );
  if (!rows[0]) return res.status(409).json({ error: 'This offer is no longer available to you' });

  await logAction({ actorUserId: req.user.sub, action: 'dispatch_declined', targetType: 'job', targetId: req.params.id });
  const dispatch = await startOrRollDispatch(req.params.id);
  res.json({ dispatch });
}));

// One-tap status advance (available -> assigned -> in_route -> started -> completed),
// plus cancellation as a side-door from any state.
const STATUS_FLOW = ['available', 'assigned', 'in_route', 'started', 'completed'];
router.post('/:id/status', requireAuth, asyncHandler(async (req, res) => {
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
}));

// Task-gated completion — every condition below must hold before a job
// can move to 'completed'. This is the brief's explicit business rule.
router.post('/:id/complete', requireAuth, asyncHandler(async (req, res) => {
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
  notifyStatusChange(updated[0], 'completed', { actorRole: req.user.role })
    .catch((e) => console.error('complete notify failed:', e.message));
  res.json({ job: updated[0] });
}));

// Task-gate field updates — separate small endpoints rather than one
// giant PATCH, so each action logs clearly in the audit trail.
router.post('/:id/consent-signed', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(`UPDATE jobs SET consent_signed = true, updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: rows[0] });
}));

router.post('/:id/payment-received', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(`UPDATE jobs SET payment_status = 'paid', updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  await logAction({ actorUserId: req.user.sub, action: 'payment_recorded', targetType: 'job', targetId: req.params.id });
  res.json({ job: rows[0] });
}));

// Admin as well as vet: admin's task checklist has a "Mark done" button
// that hit this endpoint and silently 403'd, because it was vet-only.
// Admin legitimately needs to record this — e.g. the vet phoned it in,
// or is fixing up a job after the fact.
router.post('/:id/procedure-done', requireAuth, requireRole('vet', 'admin'), asyncHandler(async (req, res) => {
  // Advance to 'started' — the vet is on site and the procedure has been
  // carried out. The job only becomes 'completed' once every task gate
  // (consent, payment, cremation if applicable) is satisfied, which is
  // handled by the /complete endpoint.
  const { rows } = await query(
    `UPDATE jobs SET procedure_done = true, procedure_done_at = now(),
       status = CASE WHEN status IN ('available','assigned','in_route') THEN 'started'::job_status ELSE status END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });

  notifyStatusChange(rows[0], rows[0].status, { actorRole: req.user.role })
    .catch((e) => console.error('procedure-done notify failed:', e.message));

  res.json({ job: rows[0] });
}));

// Vet taps "I'm on the way" from the job detail screen. Computes a
// driving ETA from the vet's current browser-reported location to the
// job address, texts the client, and pops a notification to admin —
// all in one action so the vet doesn't need to juggle three steps.
const enRouteSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

router.post('/:id/en-route', outboundMessageLimiter, requireAuth, requireRole('vet'), asyncHandler(async (req, res) => {
  const parsed = enRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Current location (lat/lng) is required', details: parsed.error.flatten() });
  }
  const { lat, lng } = parsed.data;

  const vetId = await getVetIdForUser(req.user.sub);
  if (!vetId) return res.status(403).json({ error: 'Not a vet account' });

  const { rows: jobRows } = await query('SELECT * FROM jobs WHERE id = $1 AND assigned_vet_id = $2', [req.params.id, vetId]);
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Job not found, or not assigned to you' });
  if (job.lat == null || job.lng == null) {
    return res.status(422).json({ error: 'This job has no address coordinates on file, so an ETA can\'t be calculated.' });
  }

  const { etaMinutes, distanceText } = await getDrivingEta({
    originLat: lat,
    originLng: lng,
    destLat: job.lat,
    destLng: job.lng,
  });

  const { rows: updatedRows } = await query(
    // Also advance status to 'in_route'. Previously only the en_route_*
    // fields were written, so the job stayed on 'Assigned' in every list
    // view even though the vet was already driving — 'in_route' and
    // 'started' existed in the enum but nothing ever set them.
    // Guarded so a completed/cancelled job can't be dragged backwards.
    `UPDATE jobs SET en_route_at = now(), en_route_eta_minutes = $1, en_route_distance_text = $2,
       status = CASE WHEN status IN ('available','assigned') THEN 'in_route'::job_status ELSE status END,
       updated_at = now()
     WHERE id = $3 RETURNING *`,
    [etaMinutes, distanceText, req.params.id]
  );

  const { rows: vetUserRows } = await query(
    `SELECT u.full_name FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
    [vetId]
  );
  const vetName = vetUserRows[0]?.full_name || 'Your vet';

  let smsSent = false;
  if (isMsg91Configured() && isTemplateConfigured('genericMessage') && job.client_phone) {
    try {
      await sendTemplatedSms(job.client_phone, 'genericMessage', {
        message: `Hi ${job.client_name}, ${vetName} is on the way to see ${job.pet_name} and expects to arrive in about ${etaMinutes} minute${etaMinutes === 1 ? '' : 's'}.`,
      });
      smsSent = true;
    } catch (err) {
      console.error('En-route SMS to client failed:', err.message);
    }
  }

  sendPushToAdmins({
    title: 'Vet en route',
    body: `${vetName} is on the way to ${job.pet_name} (${job.job_number}) — ETA ${etaMinutes} min.`,
    url: `/jobs/${job.id}`,
  }).catch((err) => console.error('Admin en-route push failed:', err.message));
  sendSlackMessage(`🚗 *${vetName}* is on the way to see *${job.pet_name}* (${job.job_number}) — ETA ${etaMinutes} min.`)
    .catch((err) => console.error('Slack notify for en-route failed:', err.message));

  await logAction({
    actorUserId: req.user.sub,
    action: 'vet_en_route',
    targetType: 'job',
    targetId: req.params.id,
    metadata: { etaMinutes, distanceText, smsSent },
  });

  res.json({ job: updatedRows[0], etaMinutes, distanceText, smsSent });
}));

// Vet's private medical notes — never shown to the client automatically.
/**
 * Rebuild jobs.medical_notes from the entry log.
 *
 * The column is kept as a flattened, human-readable view of the entries
 * so every existing reader (the vet-record PDF, the job payload the apps
 * already consume) keeps working without change. The entries table is
 * the source of truth; this is a derived cache.
 */
async function rebuildMedicalNotes(jobId) {
  const { rows } = await query(
    `SELECT body, author_name, author_role, created_at
     FROM job_medical_notes WHERE job_id = $1 ORDER BY created_at`,
    [jobId]
  );
  const flattened = rows
    .map((r) => {
      const when = new Date(r.created_at).toLocaleString('en-AU', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
        timeZone: 'Australia/Melbourne',
      });
      return `[${when} — ${r.author_name}] ${r.body}`;
    })
    .join('\n\n');
  await query('UPDATE jobs SET medical_notes = $1, updated_at = now() WHERE id = $2', [flattened, jobId]);
  return flattened;
}

/** All medical note entries for a job, oldest first. */
router.get('/:id/medical-notes', requireAuth, asyncHandler(async (req, res) => {
  const { rows: jobRows } = await query('SELECT assigned_vet_id FROM jobs WHERE id = $1', [req.params.id]);
  if (!jobRows[0]) return res.status(404).json({ error: 'Job not found' });

  if (req.user.role === 'vet') {
    const myVetId = await getVetIdForUser(req.user.sub);
    if (jobRows[0].assigned_vet_id !== myVetId) return res.status(403).json({ error: 'Not your job' });
  }

  const { rows } = await query(
    `SELECT id, body, author_name, author_role, created_at
     FROM job_medical_notes WHERE job_id = $1 ORDER BY created_at`,
    [req.params.id]
  );
  res.json({ entries: rows });
}));

const medicalNoteSchema = z.object({
  notes: z.string().trim().min(1, 'Write something before saving.'),
});

/**
 * Append a medical note entry.
 *
 * POST, not PUT, and deliberately append-only: clinical notes are a
 * record of what was observed at a point in time. Allowing edits would
 * let an earlier observation be silently rewritten after the fact, which
 * is exactly what makes a record indefensible if an insurer or a
 * complaint ever puts it under scrutiny. Corrections are added as a new,
 * separately timestamped entry.
 *
 * Admin may also add entries (e.g. recording something the vet phoned
 * in), and every entry records who wrote it and in what capacity.
 */
router.post('/:id/medical-notes', requireAuth, asyncHandler(async (req, res) => {
  const parsed = medicalNoteSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid note' });
  }

  const { rows: jobRows } = await query('SELECT assigned_vet_id FROM jobs WHERE id = $1', [req.params.id]);
  if (!jobRows[0]) return res.status(404).json({ error: 'Job not found' });

  if (req.user.role === 'vet') {
    const myVetId = await getVetIdForUser(req.user.sub);
    if (jobRows[0].assigned_vet_id !== myVetId) return res.status(403).json({ error: 'Not your job' });
  }

  const { rows: userRows } = await query('SELECT full_name FROM users WHERE id = $1', [req.user.sub]);
  const authorName = userRows[0]?.full_name || 'Unknown';

  await query(
    `INSERT INTO job_medical_notes (job_id, body, author_user_id, author_name, author_role)
     VALUES ($1,$2,$3,$4,$5)`,
    [req.params.id, parsed.data.notes.trim(), req.user.sub, authorName, req.user.role]
  );

  const flattened = await rebuildMedicalNotes(req.params.id);
  await logAction({
    actorUserId: req.user.sub,
    action: 'medical_note_added',
    targetType: 'job',
    targetId: req.params.id,
  });

  const { rows } = await query(
    `SELECT id, body, author_name, author_role, created_at
     FROM job_medical_notes WHERE job_id = $1 ORDER BY created_at`,
    [req.params.id]
  );
  res.status(201).json({ entries: rows, medicalNotes: flattened });
}));

router.post('/:id/cremation-booked', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { bookingRef } = req.body;
  const { rows } = await query(
    `UPDATE jobs SET cremation_booked = true, cremation_booking_ref = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [bookingRef || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  await logAction({ actorUserId: req.user.sub, action: 'cremation_booked', targetType: 'job', targetId: req.params.id });
  res.json({ job: rows[0] });
}));

router.post('/:id/ashes-returned', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(`UPDATE jobs SET ashes_returned = true, updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: rows[0] });
}));

// Per-job internal thread between admin and the assigned vet.
router.get('/:id/internal-messages', requireAuth, asyncHandler(async (req, res) => {
  const { rows: jobRows } = await query('SELECT assigned_vet_id, dispatch_offered_vet_id FROM jobs WHERE id = $1', [req.params.id]);
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (req.user.role === 'vet') {
    const myVetId = await getVetIdForUser(req.user.sub);
    const isMine = job.assigned_vet_id === myVetId || job.dispatch_offered_vet_id === myVetId;
    if (!isMine) return res.status(403).json({ error: 'Forbidden' });
  }

  const { rows } = await query(
    `SELECT m.*, u.full_name AS sender_name FROM job_internal_messages m JOIN users u ON u.id = m.sender_user_id WHERE m.job_id = $1 ORDER BY m.created_at`,
    [req.params.id]
  );

  // Reading the thread clears this side's unread flag — the other party's
  // job-list "new message" indicator goes away only once they actually
  // open the thread, not just when a reply is sent.
  const unreadColumn = req.user.role === 'admin' ? 'admin_unread_messages' : 'vet_unread_messages';
  await query(`UPDATE jobs SET ${unreadColumn} = false WHERE id = $1`, [req.params.id]);

  res.json({ messages: rows });
}));

router.post('/:id/internal-messages', requireAuth, asyncHandler(async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message body required' });

  const { rows: jobRows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (req.user.role === 'vet') {
    const myVetId = await getVetIdForUser(req.user.sub);
    const isMine = job.assigned_vet_id === myVetId || job.dispatch_offered_vet_id === myVetId;
    if (!isMine) return res.status(403).json({ error: 'Forbidden' });
  }

  const { rows } = await query(
    `INSERT INTO job_internal_messages (job_id, sender_user_id, body) VALUES ($1, $2, $3) RETURNING *`,
    [req.params.id, req.user.sub, body.trim()]
  );
  const { rows: withSender } = await query(
    `SELECT m.*, u.full_name AS sender_name FROM job_internal_messages m JOIN users u ON u.id = m.sender_user_id WHERE m.id = $1`,
    [rows[0].id]
  );

  // Flag it unread for whichever side didn't send it, and push-notify them.
  if (req.user.role === 'admin') {
    await query(`UPDATE jobs SET vet_unread_messages = true WHERE id = $1`, [job.id]);
    if (job.assigned_vet_id) {
      const { rows: vetUserRows } = await query('SELECT user_id FROM vets WHERE id = $1', [job.assigned_vet_id]);
      const vetUserId = vetUserRows[0]?.user_id;
      if (vetUserId) {
        sendPushToUser(vetUserId, { title: `New message — ${job.pet_name}`, body: body.trim().slice(0, 120), url: `/jobs/${job.id}` })
          .catch((err) => console.error('Vet message push failed:', err.message));
        sendExpoPushToUser(vetUserId, { title: `New message — ${job.pet_name}`, body: body.trim().slice(0, 120), url: `/jobs/${job.id}` })
          .catch((err) => console.error('Vet message Expo push failed:', err.message));
      }
    }
  } else {
    await query(`UPDATE jobs SET admin_unread_messages = true WHERE id = $1`, [job.id]);
    sendPushToAdmins({ title: `New message — ${job.pet_name}`, body: body.trim().slice(0, 120), url: `/jobs/${job.id}` })
      .catch((err) => console.error('Admin message push failed:', err.message));
    sendSlackMessage(`💬 New message on *${job.pet_name}* (${job.job_number}) from the vet: "${body.trim().slice(0, 200)}"`)
      .catch((err) => console.error('Slack notify for message failed:', err.message));
  }

  res.status(201).json({ message: withSender[0] });
}));

export { startOrRollDispatch };
export default router;
