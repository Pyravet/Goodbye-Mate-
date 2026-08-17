import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAction } from '../audit/log.js';
import { billBreakdown, payoutBreakdown, suggestTimeCategory, extractGst } from '../domain/pricing.js';
import { rankVets, DISPATCH_TIMEOUT_MS } from '../domain/dispatch.js';
import { getVetsWithContextForJob, getVetIdForUser } from '../domain/vetContext.js';
import { sendPushToUser, sendPushToAdmins } from '../integrations/push/webPush.js';
import { getDrivingEta } from '../integrations/maps/distanceMatrix.js';
import { sendExpoPushToUser } from '../integrations/push/expoPush.js';
import { generateRctiPdf, generateRctiPdfBuffer, rctiFilename } from '../pdf/generateRcti.js';
import { generateInvoicePdf, generateInvoicePdfBuffer, invoiceFilename } from '../pdf/generateInvoice.js';
import { chargeCard, isEwayConfigured } from '../integrations/payments/eway.js';
import { sendEmail, isEmailConfigured } from '../integrations/email/smtp.js';
import { sendTemplatedSms, isMsg91Configured } from '../integrations/sms/msg91.js';
import { isTemplateConfigured } from '../integrations/sms/templates.js';
import { sendWhatsappTemplate, isWhatsappConfigured } from '../integrations/whatsapp/msg91Whatsapp.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

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
  isPublicHoliday: z.boolean().optional().default(false),
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
  if (!parsed.success) return res.status(400).json({ error: 'Invalid job', details: parsed.error.flatten() });
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

  // Kick off auto-dispatch immediately.
  const dispatch = await startOrRollDispatch(job.id);

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const bill = billBreakdown(job, pricingRows[0].config);

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

  if (view === 'today') {
    conditions.push(`job_date = CURRENT_DATE`);
  } else if (view === 'upcoming') {
    conditions.push(`job_date > CURRENT_DATE AND status NOT IN ('completed','cancelled')`);
  } else if (view === 'past') {
    conditions.push(`(job_date < CURRENT_DATE OR status IN ('completed','cancelled'))`);
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
  const bill = billBreakdown(rows[0], pricing);
  const payout = payoutBreakdown(rows[0], pricing);

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

  const payout = payoutBreakdown(job, pricing);
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

  const bill = billBreakdown(job, pricing);
  const asQuote = req.query.quote === '1';

  generateInvoicePdf({ res, job, bill, company, asQuote });
}));

// Charge the client's card via eWay — server never receives raw card
// digits, only the fields already encrypted in the browser by eCrypt.js.
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
  const bill = billBreakdown(job, pricing);

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
router.post('/:id/email-document', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
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

      const payout = payoutBreakdown(job, pricing);
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
      const bill = billBreakdown(job, pricing);
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
router.post('/:id/sms-quote', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  if (!isMsg91Configured()) return res.status(503).json({ error: 'SMS is not configured yet.' });
  if (!isTemplateConfigured('genericMessage')) return res.status(503).json({ error: 'No SMS passthrough template configured yet.' });

  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.client_phone) return res.status(400).json({ error: 'Client has no phone number on file for this job' });

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const bill = billBreakdown(job, pricingRows[0].config);

  const message = `Hi ${job.client_name}, your quote for ${job.pet_name} is $${bill.total.toFixed(2)}. We've also sent a detailed quote to your email if provided.`;

  try {
    await sendTemplatedSms(job.client_phone, 'genericMessage', { message });
    await logAction({ actorUserId: req.user.sub, action: 'document_texted', targetType: 'job', targetId: job.id, metadata: { type: 'quote' } });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: 'Failed to send SMS', message: err.message });
  }
}));

router.post('/:id/whatsapp-quote', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  if (!isWhatsappConfigured()) return res.status(503).json({ error: 'WhatsApp is not configured yet.' });

  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.client_phone) return res.status(400).json({ error: 'Client has no phone number on file for this job' });

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const bill = billBreakdown(job, pricingRows[0].config);

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

// Manual assignment — either from the ranked list or the "assign any
// other vet" escape hatch for vets travelling outside their territory.
router.post('/:id/assign', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
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

router.post('/:id/procedure-done', requireAuth, requireRole('vet'), asyncHandler(async (req, res) => {
  const { rows } = await query(`UPDATE jobs SET procedure_done = true, procedure_done_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
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

router.post('/:id/en-route', requireAuth, requireRole('vet'), asyncHandler(async (req, res) => {
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
    `UPDATE jobs SET en_route_at = now(), en_route_eta_minutes = $1, en_route_distance_text = $2, updated_at = now()
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
router.put('/:id/medical-notes', requireAuth, requireRole('vet'), asyncHandler(async (req, res) => {
  const { notes } = req.body;
  const { rows } = await query(
    `UPDATE jobs SET medical_notes = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [notes || '', req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: rows[0] });
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
  if (req.user.role === 'vet') {
    const myVetId = await getVetIdForUser(req.user.sub);
    const { rows: jobRows } = await query('SELECT assigned_vet_id, dispatch_offered_vet_id FROM jobs WHERE id = $1', [req.params.id]);
    const job = jobRows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const isMine = job.assigned_vet_id === myVetId || job.dispatch_offered_vet_id === myVetId;
    if (!isMine) return res.status(403).json({ error: 'Forbidden' });
  }
  const { rows } = await query(
    `SELECT m.*, u.full_name AS sender_name FROM job_internal_messages m JOIN users u ON u.id = m.sender_user_id WHERE m.job_id = $1 ORDER BY m.created_at`,
    [req.params.id]
  );
  res.json({ messages: rows });
}));

router.post('/:id/internal-messages', requireAuth, asyncHandler(async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message body required' });

  if (req.user.role === 'vet') {
    const myVetId = await getVetIdForUser(req.user.sub);
    const { rows: jobRows } = await query('SELECT assigned_vet_id, dispatch_offered_vet_id FROM jobs WHERE id = $1', [req.params.id]);
    const job = jobRows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });
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
  res.status(201).json({ message: withSender[0] });
}));

export { startOrRollDispatch };
export default router;
