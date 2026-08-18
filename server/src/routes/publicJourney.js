// Public client journey — no login, secured only by the unguessable
// client_token (a UUID) baked into the link sent via SMS/email. Anyone
// with the link can view this one job's journey; nothing else is
// reachable from here. Rate-limited since these routes are unauthenticated.
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query } from '../db/pool.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { billBreakdown } from '../domain/pricing.js';
import { chargeCard, isEwayConfigured } from '../integrations/payments/eway.js';
import { generateInvoicePdf } from '../pdf/generateInvoice.js';
import { logAction } from '../audit/log.js';

const router = Router();

// Public path prefix these routes are mounted at (see index.js) — used to
// build absolute-ish hrefs for downloadable resources.
const API_BASE_PATH = '/api/public/journey';

// Generous enough for a real client re-checking the page, tight enough
// to make token-guessing (already astronomically unlikely for a UUID)
// even less practical.
const publicJourneyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
});
router.use(publicJourneyLimiter);

// vetName is passed separately because it lives on the vets/users tables,
// not on the job row. Without it, '{vetName}' rendered literally to the
// client on the "About your visit" card.
function fillPlaceholders(text, job, vetName) {
  if (!text) return text;
  return text
    .replaceAll('{vetName}', vetName || 'your vet')
    .replaceAll('{petName}', job.pet_name || '')
    .replaceAll('{clientName}', job.client_name || '')
    .replaceAll('{date}', job.job_date ? new Date(job.job_date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }) : '')
    .replaceAll('{time}', job.job_time || '')
    .replaceAll('{crematorium}', 'our cremation partner');
}

async function loadJobByToken(token) {
  const { rows } = await query('SELECT * FROM jobs WHERE client_token = $1', [token]);
  return rows[0] || null;
}

// Everything the journey page needs in one call: job status, bill,
// admin-editable content (consent text, educational intro, the right
// brochure for this job's service type), and company details for the
// footer/branding. Nothing here exposes other clients' data, vet payout
// figures, or anything admin-only.
router.get('/:token', asyncHandler(async (req, res) => {
  const job = await loadJobByToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'This link is not valid.' });

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const { rows: contentRows } = await query('SELECT config FROM content_settings WHERE id = true');

  // Assigned vet's name, for {vetName} in the client-facing copy.
  let vetName = null;
  if (job.assigned_vet_id) {
    const { rows: vetRows } = await query(
      'SELECT u.full_name FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1',
      [job.assigned_vet_id]
    );
    vetName = vetRows[0]?.full_name || null;
  }
  const content = contentRows[0].config;
  const bill = billBreakdown(job, pricingRows[0].config);

  let brochure = null;
  if (job.service_type === 'private_cremation') brochure = fillPlaceholders(content.privateCremationBrochure, job, vetName);
  else if (job.service_type === 'communal_cremation') brochure = fillPlaceholders(content.communalCremationBrochure, job, vetName);
  else brochure = fillPlaceholders(content.noCremationNote, job, vetName);

  let brochurePdf = null;
  if (job.service_type !== 'euthanasia_only') {
    // Prefer a brochure for this job's own state; fall back to the
    // nationwide 'ALL' one. ORDER BY puts the state-specific row first.
    const { rows: docRows } = await query(
      `SELECT filename, state FROM content_documents
       WHERE kind = $1 AND state IN ($2, 'ALL')
       ORDER BY CASE WHEN state = $2 THEN 0 ELSE 1 END
       LIMIT 1`,
      [job.service_type, (job.state || 'ALL').toUpperCase()]
    );
    if (docRows[0]) brochurePdf = { filename: docRows[0].filename };
  }

  // Supporting documents / grief resources — global ones plus any
  // targeted at this job's state.
  const { rows: resourceRows } = await query(
    `SELECT id, title, description, filename, url FROM client_resources
     WHERE is_active = true AND (state IS NULL OR state = $1)
     ORDER BY sort_order, created_at`,
    [(job.state || '').toUpperCase()]
  );

  const { rows: reviewRows } = await query('SELECT rating FROM job_reviews WHERE job_id = $1', [job.id]);

  res.json({
    job: {
      petName: job.pet_name,
      petType: job.pet_type,
      clientName: job.client_name,
      serviceType: job.service_type,
      jobDate: job.job_date,
      jobTime: job.job_time,
      status: job.status,
      consentSigned: job.consent_signed,
      paymentStatus: job.payment_status,
      procedureDone: job.procedure_done,
      cremationBooked: job.cremation_booked,
      ashesReturned: job.ashes_returned,
      reviewRating: reviewRows[0]?.rating ?? null,
    },
    bill: { total: bill.total, lines: bill.lines },
    content: {
      educationalIntro: fillPlaceholders(content.educationalIntro, job, vetName),
      consentTemplate: fillPlaceholders(content.consentTemplate, job, vetName),
      brochure,
      brochurePdf,
      resources: resourceRows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        // A resource is either a downloadable PDF or an outbound link.
        href: r.url || `${API_BASE_PATH}/${req.params.token}/resource/${r.id}.pdf`,
        isPdf: !r.url,
      })),
    },
    company: content.company,
    eway: { configured: isEwayConfigured() },
  });
}));

const consentSchema = z.object({
  signatureName: z.string().trim().min(2, 'Please type your full name.'),
  agree: z.literal(true, { errorMap: () => ({ message: 'You must confirm you understand and consent.' }) }),
  // Drawn signature as a PNG data URI. Optional at the schema level so
  // an older cached client build can't be locked out mid-booking, but
  // the current UI requires one before enabling submit.
  signatureImage: z.string().startsWith('data:image/png;base64,').max(2_000_000).optional().nullable(),
});

router.post('/:token/consent', asyncHandler(async (req, res) => {
  const job = await loadJobByToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'This link is not valid.' });
  if (job.consent_signed) return res.json({ ok: true, alreadySigned: true });

  const parsed = consentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid submission' });

  const signatureBuffer = parsed.data.signatureImage
    ? Buffer.from(parsed.data.signatureImage.split(',')[1], 'base64')
    : null;

  await query(
    `UPDATE jobs SET consent_signed = true, consent_signature_name = $1,
       consent_signature_image = $2, consent_signed_at = now(), updated_at = now()
     WHERE id = $3`,
    [parsed.data.signatureName, signatureBuffer, job.id]
  );
  await logAction({ actorUserId: null, action: 'consent_signed_by_client', targetType: 'job', targetId: job.id, metadata: { signatureName: parsed.data.signatureName } });

  res.json({ ok: true });
}));

const chargeSchema = z.object({
  encryptedCard: z.object({
    number: z.string().min(1),
    expiryMonth: z.string().min(1),
    expiryYear: z.string().min(1),
    cvn: z.string().min(1),
  }),
});

router.post('/:token/pay', asyncHandler(async (req, res) => {
  if (!isEwayConfigured()) return res.status(503).json({ error: 'Payment processing is not configured yet.' });

  const job = await loadJobByToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'This link is not valid.' });
  if (job.payment_status === 'paid') return res.json({ ok: true, alreadyPaid: true });

  const parsed = chargeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid card details' });

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const bill = billBreakdown(job, pricingRows[0].config);

  const result = await chargeCard({
    amountDollars: bill.total,
    invoiceReference: job.job_number,
    customerName: job.client_name,
    encryptedCard: parsed.data.encryptedCard,
  });

  await query(
    `INSERT INTO payments (job_id, amount, provider, provider_transaction_id, status, response_message)
     VALUES ($1,$2,'eway',$3,$4,$5)`,
    [job.id, bill.total, result.transactionId, result.success ? 'succeeded' : 'failed', result.responseMessage]
  );

  if (!result.success) {
    await logAction({ actorUserId: null, action: 'payment_failed', targetType: 'job', targetId: job.id, metadata: { responseMessage: result.responseMessage, source: 'client_journey' } });
    return res.status(402).json({ error: 'Payment declined', message: result.responseMessage });
  }

  await query(`UPDATE jobs SET payment_status = 'paid', payment_reference = $1, updated_at = now() WHERE id = $2`, [result.transactionId, job.id]);
  await logAction({ actorUserId: null, action: 'payment_succeeded', targetType: 'job', targetId: job.id, metadata: { transactionId: result.transactionId, amount: bill.total, source: 'client_journey' } });

  res.json({ ok: true, transactionId: result.transactionId });
}));

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
});

router.post('/:token/review', asyncHandler(async (req, res) => {
  const job = await loadJobByToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'This link is not valid.' });
  if (!job.procedure_done) return res.status(400).json({ error: 'Reviews open up after the visit.' });

  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid rating' });

  await query(
    `INSERT INTO job_reviews (job_id, rating, comment) VALUES ($1, $2, $3)
     ON CONFLICT (job_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = now()`,
    [job.id, parsed.data.rating, parsed.data.comment || null]
  );
  await logAction({ actorUserId: null, action: 'client_review_submitted', targetType: 'job', targetId: job.id, metadata: { rating: parsed.data.rating } });

  res.json({ ok: true });
}));

/**
 * GET /:token/receipt.pdf
 *
 * The client's own receipt, once payment has gone through. Deliberately
 * gated on payment_status: issuing a "receipt" for money not yet
 * received would be a false record.
 */
router.get('/:token/receipt.pdf', asyncHandler(async (req, res) => {
  const job = await loadJobByToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'This link is not valid.' });
  if (job.payment_status !== 'paid') {
    return res.status(409).json({ error: 'A receipt is available once payment has been received.' });
  }

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const { rows: lineItems } = await query(
    'SELECT label, amount, vet_payout FROM job_line_items WHERE job_id = $1 ORDER BY created_at',
    [job.id]
  );
  const bill = billBreakdown(job, pricingRows[0].config, lineItems);

  const { rows: contentRows } = await query('SELECT config FROM content_settings WHERE id = true');
  const company = contentRows[0].config.company || {};

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Receipt-${job.job_number}.pdf"`);
  generateInvoicePdf({ res, job, bill, company, asQuote: false });
}));

// Serves the uploaded brochure PDF for this job's cremation type, if one
// has been uploaded. Deliberately routed through the job token (not a
// generic /content/brochure/:kind endpoint) so a client only ever reaches
// the document relevant to their own booking.
router.get('/:token/brochure.pdf', asyncHandler(async (req, res) => {
  const job = await loadJobByToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'This link is not valid.' });
  if (job.service_type === 'euthanasia_only') return res.status(404).json({ error: 'No brochure for this service type.' });

  const { rows } = await query(
    `SELECT filename, mime_type, data FROM content_documents
     WHERE kind = $1 AND state IN ($2, 'ALL')
     ORDER BY CASE WHEN state = $2 THEN 0 ELSE 1 END
     LIMIT 1`,
    [job.service_type, (job.state || 'ALL').toUpperCase()]
  );
  const doc = rows[0];
  if (!doc) return res.status(404).json({ error: 'No brochure has been uploaded yet.' });

  res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${doc.filename.replace(/"/g, '')}"`);
  res.send(doc.data);
}));

// Serves an uploaded resource PDF, scoped to a valid job token so these
// documents aren't openly enumerable.
router.get('/:token/resource/:id.pdf', asyncHandler(async (req, res) => {
  const job = await loadJobByToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'This link is not valid.' });

  const { rows } = await query(
    'SELECT filename, mime_type, data FROM client_resources WHERE id = $1 AND is_active = true',
    [req.params.id]
  );
  const doc = rows[0];
  if (!doc || !doc.data) return res.status(404).json({ error: 'Not found.' });

  res.setHeader('Content-Type', doc.mime_type || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${(doc.filename || 'document.pdf').replace(/"/g, '')}"`);
  res.send(doc.data);
}));

export default router;
