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
import { logAction } from '../audit/log.js';

const router = Router();

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

function fillPlaceholders(text, job) {
  if (!text) return text;
  return text
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
  const content = contentRows[0].config;
  const bill = billBreakdown(job, pricingRows[0].config);

  let brochure = null;
  if (job.service_type === 'private_cremation') brochure = fillPlaceholders(content.privateCremationBrochure, job);
  else if (job.service_type === 'communal_cremation') brochure = fillPlaceholders(content.communalCremationBrochure, job);
  else brochure = fillPlaceholders(content.noCremationNote, job);

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
    },
    bill: { total: bill.total, lines: bill.lines },
    content: {
      educationalIntro: fillPlaceholders(content.educationalIntro, job),
      consentTemplate: fillPlaceholders(content.consentTemplate, job),
      brochure,
    },
    company: content.company,
    eway: { configured: isEwayConfigured() },
  });
}));

const consentSchema = z.object({
  signatureName: z.string().trim().min(2, 'Please type your full name.'),
  agree: z.literal(true, { errorMap: () => ({ message: 'You must confirm you understand and consent.' }) }),
});

router.post('/:token/consent', asyncHandler(async (req, res) => {
  const job = await loadJobByToken(req.params.token);
  if (!job) return res.status(404).json({ error: 'This link is not valid.' });
  if (job.consent_signed) return res.json({ ok: true, alreadySigned: true });

  const parsed = consentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid submission' });

  await query(
    `UPDATE jobs SET consent_signed = true, consent_signature_name = $1, consent_signed_at = now(), updated_at = now() WHERE id = $2`,
    [parsed.data.signatureName, job.id]
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

export default router;
