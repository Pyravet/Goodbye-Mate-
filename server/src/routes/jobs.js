/**
 * Jobs — the central route file.
 *
 * ~2,700 lines and 53 routes covering the whole job lifecycle. It is too
 * big, and splitting it is the right eventual move; it hasn't been done
 * because route-level tests currently cover only the money paths, and
 * relocating 53 handlers without that net is how regressions ship.
 *
 * Until then it is divided into labelled sections. Search for the banner
 * to jump to one:
 *
 *   LISTING & SEARCH            list, filters, alerts, duplicates, reviews
 *   DISPATCH & OFFERS           offering to vets, accept/decline, assignment
 *   PETS & CONSENT              pets on a job, per-pet consent
 *   MONEY                       line items, charges, refunds, cancellation fee
 *   DOCUMENTS (PDF & EMAIL)     invoices, consent forms, vet records
 *   JOB LIFECYCLE               en route, procedure done, complete, cancel
 *   NOTES & INTERNAL MESSAGES   medical notes, admin notes, vet<->admin thread
 *
 * TWO THINGS THAT WILL CATCH YOU OUT:
 *
 * 1. Route order matters. Express matches in declaration order, so any
 *    literal path (/offers/mine, /check-duplicate, /reviews/all) MUST be
 *    declared above '/:id' or it will be read as a job id and 404.
 *
 * 2. jobs.pet_* MIRRORS the first row in job_pets; job_pets is the
 *    source of truth. The mirror is written ONLY by syncPrimaryPet in
 *    domain/jobPets.js. Update it anywhere else and the two silently
 *    drift, which surfaces as a PDF naming the wrong animal.
 */

import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAction } from '../audit/log.js';
import { notifyUser, notifyAdmins } from '../notifications/notify.js';
import { billBreakdown, payoutBreakdown, suggestTimeCategory, extractGst, clientGstSplit } from '../domain/pricing.js';
import { rankVets, DISPATCH_TIMEOUT_MS } from '../domain/dispatch.js';
import { cancellationFee, hoursUntilAppointment } from '../domain/cancellation.js';
import { duplicateScore, normalisePhone, sortByConfidence } from '../domain/duplicates.js';
import { getPets, syncPrimaryPet, createFirstPet, withPetCount, withPetCounts } from '../domain/jobPets.js';
import { requiresManualDispatch } from '../domain/handling.js';
import { getVetsWithContextForJob, getVetIdForUser } from '../domain/vetContext.js';
import { sendPushToUser, sendPushToAdmins } from '../integrations/push/webPush.js';
import { getDrivingEta } from '../integrations/maps/distanceMatrix.js';
import { sendSlackMessage } from '../integrations/slack/webhook.js';
import { sendExpoPushToUser } from '../integrations/push/expoPush.js';
import { generateRctiPdf, generateRctiPdfBuffer, rctiFilename } from '../pdf/generateRcti.js';
import { generateVetRecordPdf, generateVetRecordPdfBuffer, vetRecordFilename } from '../pdf/generateVetRecord.js';
import { generateConsentPdf, consentFilename } from '../pdf/generateConsent.js';
import { generateInvoicePdf, generateInvoicePdfBuffer, invoiceFilename } from '../pdf/generateInvoice.js';
import { chargeCard, isEwayConfigured, refundTransaction } from '../integrations/payments/eway.js';
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
  time: z.string().min(1), // HH:MM — start of the window when timeEnd is set
  handlingHelp: z.enum(['not_needed', 'client_helps', 'direct_pickup', 'needs_help', 'assistant']).optional(),
  pace: z.enum(['slow', 'normal', 'quick']).optional(),
  handlingNotes: z.string().trim().max(1000).optional().nullable(),
  timeEnd: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  extraTravelFee: z.number().optional().default(0),
  isPublicHoliday: z.boolean().optional().default(false),
  notes: z.string().optional(),
});

// Line items (extra charges + discounts) for a job. Every bill/payout
// calculation must include these or the client is quoted one figure and
// invoiced another — so this is fetched everywhere billBreakdown is used.
/**
 * GST breakdown for a client-facing document, or null when the business
 * isn't GST registered (in which case nothing GST-related is shown).
 */
function clientGst(total, pricing) {
  const split = clientGstSplit(total, pricing);
  return split.isGstRegistered
    ? { ...split, ratePercent: Number(pricing?.gstPercent) || 10 }
    : null;
}

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
export async function startOrRollDispatch(jobId) {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job) return null;

  const vetsWithContext = await getVetsWithContextForJob(job);
  const declined = job.dispatch_declined_vet_ids || [];
  // Heavy or unknown-weight pets, and jobs where nobody can help carry,
  // are never offered automatically. A vet works alone: before
  // accepting a large animal they need to know the weight and whether
  // anyone at the home can help — that's a conversation, not something
  // to spring on them in an offer they have minutes to answer.
  //
  // Checked HERE rather than at the call sites so both entry points —
  // job creation and the rollover worker — are covered by one guard.
  const { rows: dispatchPricing } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const manualCheck = requiresManualDispatch(job, dispatchPricing[0]?.config || {});
  if (manualCheck.manual) {
    await query(
      `UPDATE jobs SET dispatch_state = 'unassigned', updated_at = now() WHERE id = $1`,
      [jobId]
    );
    notifyAdmins({
      title: 'Needs a vet chosen by hand',
      body: `${job.pet_name} (${job.job_number}): ${manualCheck.reason}`,
      url: `/jobs/${jobId}`,
      category: 'job',
    }).catch((e) => console.error('manual-dispatch notify failed:', e.message));
    return { state: 'manual_required', reason: manualCheck.reason };
  }

  const ranked = rankVets(job, vetsWithContext).filter((r) => !declined.includes(r.vetId) && r.score > -150);
  const next = ranked[0];

  if (next) {
    const expiresAt = new Date(Date.now() + DISPATCH_TIMEOUT_MS);
    await query(
      `UPDATE jobs SET dispatch_state = 'offered', dispatch_offered_vet_id = $1, dispatch_expires_at = $2, updated_at = now() WHERE id = $3`,
      [next.vetId, expiresAt, jobId]
    );

    // Append-only offer history. The job's dispatch_* columns are
    // overwritten as soon as the offer moves on, so without this a
    // decline or timeout leaves no trace and reliability can't be
    // measured at all.
    //
    // Deliberately NOT awaited into the failure path: reliability
    // reporting is secondary, and if this insert fails (missing table,
    // constraint, anything) it must not take down the offer itself.
    // The UPDATE above has already committed, so throwing here would
    // leave a job offered but the request erroring - the worst of both.
    query(
      `INSERT INTO vet_job_offers (job_id, vet_id, outcome) VALUES ($1, $2, 'offered')`,
      [jobId, next.vetId]
    ).catch((e) => console.error('Could not record offer history:', e.message));

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

    // Tell admin. A job running out of vets is the single most
    // time-critical state in the system — a client has a booking nobody
    // is attending — and it happened SILENTLY: the job simply sat at
    // 'unassigned' until someone noticed. Every other dispatch outcome
    // notified somebody; this one, the one that actually needs a human,
    // did not.
    notifyAdmins({
      title: 'No vet available',
      body: `${job.pet_name} (${job.job_number}) on ${String(job.job_date).slice(0, 10)} `
        + `at ${String(job.job_time).slice(0, 5)} has no vet — every eligible vet declined or timed out.`,
      url: `/jobs/${jobId}`,
      category: 'job',
    }).catch((e) => console.error('unassigned notify failed:', e.message));

    sendSlackMessage(
      `⚠️ No vet available for ${job.pet_name} (${job.job_number}) — `
      + `${String(job.job_date).slice(0, 10)} at ${String(job.job_time).slice(0, 5)}. Needs manual assignment.`
    ).catch((e) => console.error('unassigned slack failed:', e.message));

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
      service_id, service_type, job_date, job_time, job_time_end, time_category, extra_travel_fee, notes, is_public_holiday,
      handling_help, pace, handling_notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
    RETURNING *`,
    [
      d.clientName, d.clientPhone, d.clientEmail || null, d.address, d.suburb || null, d.postcode, d.state, d.lat ?? null, d.lng ?? null,
      d.petName, d.petType, d.petBreed || null, d.petWeight || null, d.petAge || null, d.petBehaviour || 'Friendly',
      d.serviceId, d.serviceType, d.date, d.time, d.timeEnd || null, timeCategory, d.extraTravelFee || 0, d.notes || null, d.isPublicHoliday || false,
      d.handlingHelp || 'not_needed', d.pace || 'normal', d.handlingNotes || null,
    ]
  );
  const job = rows[0];

  // Every job needs a job_pets row. The migration backfilled existing
  // jobs, but the CREATE route was never updated — so every booking made
  // since had zero pets, and the consent endpoint refuses a job with no
  // pet on it. In other words: no new client could sign consent at all.
  //
  // Created here rather than by a trigger so it stays visible to anyone
  // reading the creation flow.
  await createFirstPet(job);

  await logAction({ actorUserId: req.user.sub, action: 'job_created', targetType: 'job', targetId: job.id, metadata: { jobNumber: job.job_number } });

  // NOTHING is sent to the client at booking time.
  //
  // A booking isn't real until a vet has accepted it: the time can move,
  // and the job can end up uncovered entirely. Texting "your booking is
  // confirmed" before anyone has agreed to attend sets an expectation
  // the business may not be able to meet, to someone who has just
  // decided to put their pet down. It also can't name the attending vet,
  // because there isn't one yet.
  //
  // The client is contacted once a vet ACCEPTS (see the accept route),
  // and admin can send the journey link manually at any point from the
  // job page if they want it out earlier.

  // Kick off auto-dispatch immediately.
  //
  // Wrapped because the job is ALREADY saved by this point. An
  // unhandled throw here returns a 500 to admin while leaving a real
  // booking in the database with no offer made and no error surfaced
  // anywhere — which presents exactly as "the booking exists but no vet
  // ever sees it". Returning the failure lets admin see and retry.
  let dispatch;
  try {
    dispatch = await startOrRollDispatch(job.id);
  } catch (err) {
    console.error('Dispatch failed for new job:', job.job_number, err.message, err.stack);
    dispatch = { state: 'error', message: err.message };
  }

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const bill = billBreakdown(job, pricingRows[0].config, await getLineItems(job.id));

  res.status(201).json({ job, dispatch, bill });
}));

// Today / Upcoming / Past / Board (all) — the four admin views from the brief.
// For vets, results are automatically restricted to their own offers and
// assignments — a vet has no reason to see other vets' jobs, and the admin
// board view isn't available to them at all.

// ========================================================================
// LISTING & SEARCH =======================================================
// ========================================================================

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { view, search } = req.query;
  const conditions = [];
  const params = [];

  if (req.user.role === 'vet') {
    const myVetId = await getVetIdForUser(req.user.sub);
    if (!myVetId) return res.status(403).json({ error: 'Not a vet account' });
    params.push(myVetId);
    // Offers now live in vet_job_offers (one row per vet), so matching
    // on the single dispatch_offered_vet_id column would hide jobs a vet
    // was genuinely offered alongside others.
    conditions.push(
      `(jobs.assigned_vet_id = $${params.length} OR EXISTS (
         SELECT 1 FROM vet_job_offers o
         WHERE o.job_id = jobs.id AND o.vet_id = $${params.length}
           AND o.outcome IN ('offered', 'proposed')
       ))`
    );
  }

  // "Today" must mean today in AUSTRALIA, not on the database server.
  // CURRENT_DATE resolves in the server's timezone (UTC on Neon), so for
  // most of the Australian working day UTC is still on the PREVIOUS
  // date — a job booked for today sat in "Upcoming" until ~10am AEST.
  // BUSINESS_TZ centralises this so the three views can't drift apart.
  if (view === 'today') {
    conditions.push(`jobs.job_date = (now() AT TIME ZONE '${BUSINESS_TZ}')::date`);
  } else if (view === 'upcoming') {
    conditions.push(`jobs.job_date > (now() AT TIME ZONE '${BUSINESS_TZ}')::date AND jobs.status NOT IN ('completed','cancelled')`);
  } else if (view === 'past') {
    conditions.push(`(jobs.job_date < (now() AT TIME ZONE '${BUSINESS_TZ}')::date OR jobs.status IN ('completed','cancelled'))`);
  }
  // 'board' (or no view param) = everything the conditions above already allow.

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(jobs.client_name ILIKE $${params.length} OR jobs.pet_name ILIKE $${params.length} OR jobs.suburb ILIKE $${params.length} OR jobs.job_number ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // Join the vet's name in. The list previously returned only
  // assigned_vet_id (a UUID), so every screen showing a job — the board,
  // the calendar — could show WHETHER a vet was assigned but never WHO,
  // which is the thing admin actually needs at a glance.
  const { rows } = await query(
    `SELECT jobs.*, u.full_name AS vet_name
     FROM jobs
     LEFT JOIN vets v ON v.id = jobs.assigned_vet_id
     LEFT JOIN users u ON u.id = v.user_id
     ${where}
     ORDER BY jobs.job_date, jobs.job_time`,
    params
  );

  // Strip client PII from jobs a vet has only been OFFERED.
  //
  // Offering one job to five vets meant handing the client's name,
  // phone, email and street address to four people who will never
  // attend. They need enough to judge the job — suburb, timing, pet,
  // payout — not who the client is or where they live. Full details
  // appear as soon as they accept.
  if (req.user.role === 'vet') {
    const myVetId = await getVetIdForUser(req.user.sub);
    const safe = rows.map((job) => {
      if (job.assigned_vet_id === myVetId) return job;
      const {
        client_name, client_phone, client_email, address,
        client_token, medical_notes, admin_notes, consent_signature_name,
        ...rest
      } = job;
      return { ...rest, isOffer: true };
    });
    return res.json({ jobs: safe });
  }

  res.json({ jobs: rows });
}));

// MUST precede '/:id' — Express matches in declaration order, so
// "offers" would otherwise be read as a job id and 404.
/**
 * GET /jobs/offers/mine — a vet's live offers.
 *
 * Kept as its own endpoint rather than folded into the jobs list so the
 * vet app can show offers as a distinct area: an offer is a decision to
 * make, not a job they hold, and mixing the two buries it.
 */
const duplicateCheckSchema = z.object({
  clientName: z.string().trim().optional().nullable(),
  clientPhone: z.string().trim().optional().nullable(),
  clientEmail: z.string().trim().optional().nullable(),
  petName: z.string().trim().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  // Set when editing, so a job isn't flagged as a duplicate of itself.
  excludeJobId: z.string().uuid().optional().nullable(),
});

/**
 * POST /jobs/check-duplicate
 *
 * Called before creating a booking. A duplicate here means two vets
 * dispatched to one grieving family, two charges and two sets of
 * paperwork — so this warns BEFORE the job exists rather than leaving
 * someone to notice afterwards.
 *
 * Deliberately advisory: it returns matches, it does not block. Two
 * genuinely separate bookings for the same household do happen (a second
 * pet, a rebooking after a cancellation), and refusing them outright
 * would be worse than a warning someone can read and dismiss.
 */
router.post('/check-duplicate', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = duplicateCheckSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid check' });
  const d = parsed.data;

  const phoneDigits = normalisePhone(d.clientPhone);
  const email = (d.clientEmail || '').trim().toLowerCase();
  if (!phoneDigits && !email) return res.json({ matches: [] });

  // Narrow in SQL on the identifiers, then score in JS. Matching the
  // phone in Postgres needs the same digits-only normalisation, so it's
  // done with regexp_replace rather than assuming stored formatting.
  const { rows } = await query(
    `SELECT id, job_number, client_name, client_phone, client_email,
            pet_name, job_date, job_time, status, assigned_vet_id
     FROM jobs
     WHERE status <> 'cancelled'
       AND ($3::uuid IS NULL OR id <> $3)
       AND (
         ($1 <> '' AND right(regexp_replace(client_phone, '\\D', '', 'g'), 9) = $1)
         OR ($2 <> '' AND lower(trim(client_email)) = $2)
       )
     ORDER BY job_date DESC
     LIMIT 20`,
    [phoneDigits, email, d.excludeJobId || null]
  );

  const matches = rows
    .map((job) => {
      const score = duplicateScore(d, job);
      if (!score.level) return null;
      return {
        jobId: job.id,
        jobNumber: job.job_number,
        clientName: job.client_name,
        petName: job.pet_name,
        jobDate: job.job_date,
        jobTime: job.job_time,
        status: job.status,
        hasVet: !!job.assigned_vet_id,
        ...score,
      };
    })
    .filter(Boolean);

  res.json({ matches: sortByConfidence(matches) });
}));

/**
 * GET /jobs/reviews/all — every client review.
 *
 * Reviews were being collected and read by nobody: there was no admin
 * route or screen for them anywhere. That's worst for the low ratings,
 * where the client was specifically asked "what could we have done
 * better" and took the trouble to answer.
 *
 * Sorted lowest-rating first by default, because a 2-star with a comment
 * is the one that needs acting on, and it's the one that would otherwise
 * sit unread behind a page of 5-stars.
 */
router.get('/reviews/all', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const onlyLow = req.query.lowOnly === 'true';

  const { rows } = await query(
    `SELECT r.rating, r.comment, r.created_at,
            j.id AS job_id, j.job_number, j.pet_name, j.client_name, j.job_date,
            u.full_name AS vet_name
     FROM job_reviews r
     JOIN jobs j ON j.id = r.job_id
     LEFT JOIN vets v ON v.id = j.assigned_vet_id
     LEFT JOIN users u ON u.id = v.user_id
     ${onlyLow ? 'WHERE r.rating <= 3' : ''}
     ORDER BY r.rating ASC, r.created_at DESC
     LIMIT 200`
  );

  const { rows: statsRows } = await query(
    `SELECT COUNT(*)::int AS total,
            ROUND(AVG(rating)::numeric, 2) AS average,
            COUNT(*) FILTER (WHERE rating <= 3)::int AS low,
            COUNT(*) FILTER (WHERE comment IS NOT NULL AND trim(comment) <> '')::int AS with_comment
     FROM job_reviews`
  );

  res.json({ reviews: rows, stats: statsRows[0] });
}));


// ========================================================================
// DISPATCH & OFFERS ======================================================
// ========================================================================

router.get('/offers/mine', requireAuth, requireRole('vet'), asyncHandler(async (req, res) => {
  const myVetId = await getVetIdForUser(req.user.sub);
  if (!myVetId) return res.status(403).json({ error: 'Not a vet account' });

  const { rows } = await query(
    `SELECT o.id AS offer_id, o.outcome, o.expires_at, o.offered_at,
            o.proposed_date, o.proposed_time, o.proposal_note,
            j.id, j.job_number, j.pet_name, j.pet_type, j.pet_breed, j.pet_weight,
            -- Street address deliberately EXCLUDED. This endpoint feeds
            -- the offers screen, which several vets see for the same
            -- job; handing one family's address to four people who will
            -- never attend is the exact leak the jobs list was fixed
            -- for. Suburb is enough to judge the travel. The full
            -- address appears once a vet accepts.
            j.suburb, j.postcode, j.state,
            j.job_date, j.job_time, j.service_type, j.notes, j.status,
            -- A vet needs to know WHY before accepting: the clinical
            -- reason, the family's situation, anything unusual. Admin
            -- notes were written for exactly this and were never shown.
            j.admin_notes,
            -- Needed by payoutBreakdown for the assistant fee. Without
            -- it handling_help is undefined and the extra person's
            -- money silently vanishes from the offer.
            j.handling_help, j.pace, j.handling_notes,
            j.assigned_vet_id,
            -- Needed by payoutBreakdown. Without time_category the
            -- after-hours rate silently falls back to weekday, showing a
            -- vet a lower figure than they'd actually be paid.
            j.service_id, j.time_category, j.extra_travel_fee
     FROM vet_job_offers o
     JOIN jobs j ON j.id = o.job_id
     WHERE o.vet_id = $1
       AND o.outcome IN ('offered', 'proposed')
       AND j.status NOT IN ('completed', 'cancelled')
       -- Someone else accepting ends the offer for everyone; without
       -- this the losers would keep seeing a job that's already gone.
       AND j.assigned_vet_id IS NULL
       AND (o.expires_at IS NULL OR o.expires_at > now())
     ORDER BY j.job_date, j.job_time`,
    [myVetId]
  );

  // What each job pays. A vet deciding whether to accept needs to know
  // what it's worth — otherwise they're agreeing to drive somewhere for
  // an amount they only discover afterwards. Job detail already returned
  // this for offers; the LIST didn't, which is the screen they actually
  // decide from.
  //
  // Line items are fetched in ONE query for all offered jobs rather than
  // per job, since this runs on every poll of the offers screen.
  const jobIds = rows.map((r) => r.id);
  const itemsByJob = new Map();
  if (jobIds.length > 0) {
    const { rows: allItems } = await query(
      'SELECT job_id, label, amount, vet_payout FROM job_line_items WHERE job_id = ANY($1::uuid[])',
      [jobIds]
    );
    for (const item of allItems) {
      if (!itemsByJob.has(item.job_id)) itemsByJob.set(item.job_id, []);
      itemsByJob.get(item.job_id).push(item);
    }
  }

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const pricing = pricingRows[0].config;

  // Every pet on the job, not just the mirrored first one. A double
  // euthanasia was being offered as though it were a single visit —
  // wrong work and wrong money.
  const withCounts = await withPetCounts(rows);
  const { rows: petRows } = jobIds.length
    ? await query(
        `SELECT job_id, name, species, breed, weight
         FROM job_pets WHERE job_id = ANY($1::uuid[]) ORDER BY sort_order`,
        [jobIds]
      )
    : { rows: [] };
  const petsByJob = new Map();
  for (const pet of petRows) {
    if (!petsByJob.has(pet.job_id)) petsByJob.set(pet.job_id, []);
    petsByJob.get(pet.job_id).push(pet);
  }

  const offers = withCounts.map((r) => ({
    ...r,
    pets: petsByJob.get(r.id) || [],
    payout: payoutBreakdown(r, pricing, itemsByJob.get(r.id) || []).total,
  }));

  res.json({ offers });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });

  if (req.user.role === 'vet') {
    const myVetId = await getVetIdForUser(req.user.sub);
    const job = rows[0];

    // Checking dispatch_offered_vet_id alone only ever recognised ONE
    // vet, so with multi-vet offers a vet legitimately offered a job was
    // refused access to it. Access is granted if they hold the job OR
    // have a live offer row for it.
    const { rows: offerRows } = await query(
      `SELECT 1 FROM vet_job_offers
       WHERE job_id = $1 AND vet_id = $2 AND outcome IN ('offered', 'proposed') LIMIT 1`,
      [req.params.id, myVetId]
    );
    const holdsJob = job.assigned_vet_id === myVetId;
    const hasOffer = offerRows.length > 0;
    if (!holdsJob && !hasOffer) return res.status(403).json({ error: 'Forbidden' });

    // A vet deciding whether to ACCEPT doesn't need the client's name,
    // phone, email or exact street address — only enough to judge the
    // job (suburb, timing, pet, payout). Withholding it until they
    // commit limits how much personal data is exposed by broadcasting a
    // job to several vets, most of whom will never attend.
    if (!holdsJob) {
      const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
      const items = await getLineItems(job.id);
      return res.json({
        job: {
          id: job.id,
          job_number: job.job_number,
          job_date: job.job_date,
          job_time: job.job_time,
          suburb: job.suburb,
          postcode: job.postcode,
          state: job.state,
          pet_name: job.pet_name,
          pet_type: job.pet_type,
          pet_breed: job.pet_breed,
          pet_weight: job.pet_weight,
          pet_age: job.pet_age,
          pet_behaviour: job.pet_behaviour,
          service_type: job.service_type,
          time_category: job.time_category,
          // Every pet, so an offer for a double euthanasia doesn't read
          // as a single visit.
          pets: (await getPets(job.id)).map((p) => ({
            name: p.name, species: p.species, breed: p.breed, weight: p.weight,
          })),
          notes: job.notes,
          status: job.status,
          isOffer: true,
        },
        payout: payoutBreakdown(await withPetCount(job), pricingRows[0].config, items),
      });
    }
  }

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const pricing = pricingRows[0].config;
  const jobWithPets = await withPetCount(rows[0]);
  // The pet LIST as well as the count: the vet screen titles the job
  // with every animal's name, and without this it silently falls back
  // to the mirrored first pet — which is the bug it was meant to fix.
  jobWithPets.pets = await getPets(rows[0].id);
  const bill = billBreakdown(jobWithPets, pricing, await getLineItems(rows[0].id));
  const payout = payoutBreakdown(jobWithPets, pricing, await getLineItems(rows[0].id));

  // The client's review. Written into job_reviews but never read by any
  // admin route — so feedback, including the "what could we have done
  // better" a client took the trouble to write after a 1-4 star rating,
  // was collected and seen by nobody.
  const { rows: reviewRows } = await query(
    'SELECT rating, comment, created_at FROM job_reviews WHERE job_id = $1',
    [req.params.id]
  );

  // Where the job came from. Recorded at conversion but never read
  // back, so a clinic referral looked identical to a walk-in.
  let referredByClinic = null;
  if (rows[0].referred_by_clinic_id) {
    const { rows: clinicRows } = await query(
      'SELECT id, name, phone FROM clinics WHERE id = $1', [rows[0].referred_by_clinic_id]
    );
    referredByClinic = clinicRows[0] || null;
  }

  res.json({ job: jobWithPets, review: reviewRows[0] || null, referredByClinic, bill, payout });
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

// ========================================================================
// DOCUMENTS (PDF & EMAIL) ================================================
// ========================================================================

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

  generateInvoicePdf({ res, job, bill, company, asQuote, gst: clientGst(bill.total, pricingRows[0].config) });
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

export async function sendJourneyLink(job) {
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
      const buffer = await generateInvoicePdfBuffer({ job, bill, company, asQuote, gst: clientGst(bill.total, pricing) });

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
    await notifyAdmins({ title: 'Job update', body, url: `/jobs/${job.id}`, category: 'job' })
      .catch((e) => console.error('notify admins failed:', e.message));
  }
  await sendSlackMessage(`📋 ${body}`).catch((e) => console.error('status slack failed:', e.message));
}

// --- Cancel a job ---
/**
 * GET /jobs/:id/cancellation-preview
 *
 * What would cancelling cost right now? Admin is usually on the phone
 * to the client when they need this, so the figure has to be visible
 * BEFORE confirming — discovering a fee after the fact means ringing
 * someone back to tell them they've been charged.
 */
router.get('/:id/cancellation-preview', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const pricing = pricingRows[0].config;

  const bill = billBreakdown(job, pricing, await getLineItems(job.id));
  const hoursNotice = hoursUntilAppointment(job.job_date, job.job_time);
  const result = cancellationFee({ billTotal: bill.total, hoursNotice, pricing });

  res.json({
    billTotal: bill.total,
    hoursNotice: hoursNotice == null ? null : Math.round(hoursNotice * 10) / 10,
    ...result,
    alreadyPaid: job.payment_status === 'paid',
  });
}));

router.post('/:id/cancel', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const reason = (req.body?.reason || '').trim() || null;

  // Work out the cancellation fee BEFORE the update, while the job
  // still has its original date/time — the row is about to be marked
  // cancelled and the notice period is relative to the appointment.
  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const pricingConfig = pricingRows[0].config;
  const { rows: existingRows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const existingJob = existingRows[0];
  if (!existingJob) return res.status(404).json({ error: 'Job not found' });

  const bill = billBreakdown(existingJob, pricingConfig, await getLineItems(existingJob.id));
  const notice = hoursUntilAppointment(existingJob.job_date, existingJob.job_time);
  // Admin can override the calculated fee, or waive it entirely — the
  // policy is a default, not a rule the person on the phone can't
  // depart from when someone's pet died overnight.
  const waived = req.body?.waiveFee === true;
  const calculated = cancellationFee({ billTotal: bill.total, hoursNotice: notice, pricing: pricingConfig });
  const fee = waived
    ? 0
    : (req.body?.feeOverride != null ? Number(req.body.feeOverride) : calculated.fee);

  const { rows } = await query(
    `UPDATE jobs SET status = 'cancelled', cancelled_at = now(),
       cancellation_fee = $2, cancellation_fee_waived = $3, cancellation_reason = $1,
       dispatch_state = 'none', dispatch_expires_at = NULL, updated_at = now()
     WHERE id = $4 AND status <> 'cancelled' RETURNING *`,
    [reason, fee, waived, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Job not found, or already cancelled.' });

  await logAction({
    actorUserId: req.user.sub,
    action: 'job_cancelled',
    targetType: 'job',
    targetId: req.params.id,
    // The calculated figure is logged alongside what was actually
    // charged, so a waiver or override is visible as a decision someone
    // made rather than looking like the policy simply didn't fire.
    metadata: { reason, fee, waived, calculatedFee: calculated.fee, hoursNotice: notice },
  });
  notifyStatusChange(rows[0], 'cancelled', { actorRole: 'admin', reason })
    .catch((e) => console.error('cancel notify failed:', e.message));

  res.json({
    job: rows[0],
    cancellation: { fee, waived, calculated, hoursNotice: notice },
  });
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


// ========================================================================
// MONEY ==================================================================
// ========================================================================

router.get('/:id/line-items', requireAuth, asyncHandler(async (req, res) => {
  // Pricing and vet payout for a job shouldn't be readable by a vet who
  // has nothing to do with it.
  const { rows: jobRows } = await query('SELECT assigned_vet_id FROM jobs WHERE id = $1', [req.params.id]);
  if (!jobRows[0]) return res.status(404).json({ error: 'Job not found' });
  if (req.user.role !== 'admin') {
    const myVetId = await getVetIdForUser(req.user.sub);
    if (!myVetId || jobRows[0].assigned_vet_id !== myVetId) {
      return res.status(403).json({ error: 'This job is not assigned to you.' });
    }
  }

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

/**
 * Re-run dispatch on a job that was never successfully offered.
 *
 * Needed because dispatch can fail after the job is saved (and now
 * fails soft rather than erroring the whole request), leaving a real
 * booking sitting at dispatch_state 'none' with no vet ever seeing it.
 * Without this the only remedy was assigning someone manually, which
 * skips the offer/accept step entirely.
 */
router.post('/:id/redispatch', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT id, status, assigned_vet_id, dispatch_offered_vet_id, dispatch_state FROM jobs WHERE id = $1',
    [req.params.id]
  );
  const existing = rows[0];
  if (!existing) return res.status(404).json({ error: 'Job not found' });
  if (existing.status === 'cancelled') {
    return res.status(409).json({ error: 'This job is cancelled.' });
  }

  // If someone already holds this job, re-offering must go to a
  // DIFFERENT vet — otherwise ranking would simply hand it straight back
  // to the same person, making the action look broken. The current
  // holder is added to the declined list (which ranking already
  // excludes) and the assignment cleared so the job is offerable again.
  const currentVetId = existing.assigned_vet_id
    || (existing.dispatch_state === 'offered' ? existing.dispatch_offered_vet_id : null);

  if (currentVetId) {
    await query(
      `UPDATE jobs
       SET assigned_vet_id = NULL,
           status = CASE WHEN status IN ('assigned','in_route') THEN 'available'::job_status ELSE status END,
           dispatch_declined_vet_ids =
             CASE WHEN $1 = ANY(dispatch_declined_vet_ids)
                  THEN dispatch_declined_vet_ids
                  ELSE array_append(dispatch_declined_vet_ids, $1) END,
           updated_at = now()
       WHERE id = $2`,
      [currentVetId, req.params.id]
    );
  }

  try {
    const dispatch = await startOrRollDispatch(req.params.id);
    await logAction({
      actorUserId: req.user.sub,
      action: 'job_redispatched',
      targetType: 'job',
      targetId: req.params.id,
      metadata: { state: dispatch?.state, skippedVetId: currentVetId || null },
    });

    // Say plainly when nobody could be found, rather than returning a
    // success the UI shows as nothing happening.
    if (!dispatch || dispatch.state === 'unassigned') {
      return res.json({
        dispatch,
        message: 'No eligible vet could be found for this job — check the dispatch details below.',
      });
    }
    res.json({ dispatch });
  } catch (err) {
    console.error('Redispatch failed:', err.message, err.stack);
    // Surface the real reason — this endpoint exists precisely because
    // dispatch failures were invisible.
    res.status(500).json({ error: `Dispatch failed: ${err.message}` });
  }
}));

/**
 * GET /jobs/:id/suggested-vets
 *
 * Vets ranked for THIS job, using the same engine auto-dispatch uses.
 *
 * The manual assign list was a flat alphabetical roster: to reassign
 * well, admin had to remember who covers that postcode, who is free,
 * and who is already double-booked. That's the exact judgement the
 * ranking engine already encodes — it was simply never surfaced to a
 * human. Unlike /vets/matching this needs no coordinates, which most
 * jobs lack while the Maps keys are invalid.
 */
router.get('/:id/suggested-vets', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const vetsWithContext = await getVetsWithContextForJob(job);
  const declined = job.dispatch_declined_vet_ids || [];

  const ranked = rankVets(job, vetsWithContext).map((r) => ({
    vetId: r.vetId,
    name: r.name,
    score: r.score,
    territory: r.label,
    available: r.available,
    conflict: r.conflict,
    activeJobCount: r.activeJobCount,
    isCurrent: r.vetId === job.assigned_vet_id,
    hasDeclined: declined.includes(r.vetId),
    // Surfaced so admin can see WHY someone is ranked low rather than
    // just seeing a number — a conflict and a quiet diary look the same
    // otherwise.
    warnings: [
      r.conflict && 'already booked at a clashing time',
      !r.available && 'not available at this time',
      declined.includes(r.vetId) && 'declined this job',
    ].filter(Boolean),
  }));

  res.json({ vets: ranked, currentVetId: job.assigned_vet_id });
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

  // Reassigning away from a vet who had ACCEPTED is a dropout: a job
  // that looked covered suddenly isn't. Recorded separately from a
  // decline, because short notice is what actually hurts operationally.
  if (previousVetId) {
    // INSERT ... SELECT so hours_before_visit can be computed from the
    // job's own date/time in the same statement. job_date is a DATE and
    // job_time a TIME, so they're combined before the comparison.
    await query(
      `INSERT INTO vet_job_dropouts (job_id, vet_id, hours_before_visit, reason, recorded_by)
       SELECT j.id, $2,
              EXTRACT(EPOCH FROM ((j.job_date + j.job_time) - now())) / 3600.0,
              $3, $4
       FROM jobs j WHERE j.id = $1`,
      [req.params.id, previousVetId, req.body?.reason || 'Reassigned by admin', req.user.sub]
    ).catch((e) => console.error('Could not record dropout:', e.message));
  }

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
      // Via notifyUser, not raw push: push is fire-and-forget and can be
      // disabled or missed entirely. Losing a job you'd committed to is
      // exactly the message that must survive that, so it lands in the
      // bell as well.
      await notifyUser(prev.user_id, { title: 'Job reassigned', body, url: '/', category: 'job' })
        .catch((e) => console.error('reassign notify failed:', e.message));
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
/**
 * Close out the open offer row for a vet on a job.
 *
 * Updates the most recent 'offered' row rather than inserting a new one,
 * so the history reads as one offer with one outcome. response_seconds
 * is computed here and stored, so response-time stats don't need a
 * calculation per row later.
 */
async function recordOfferOutcome(jobId, vetId, outcome, declineReason) {
  await query(
    `UPDATE vet_job_offers
     SET outcome = $1,
         responded_at = now(),
         response_seconds = EXTRACT(EPOCH FROM (now() - offered_at))::int,
         decline_reason = COALESCE($2, decline_reason)
     WHERE id = (
       SELECT id FROM vet_job_offers
       WHERE job_id = $3 AND vet_id = $4 AND outcome = 'offered'
       ORDER BY offered_at DESC LIMIT 1
     )`,
    [outcome, declineReason || null, jobId, vetId]
  );
}

router.post('/:id/dispatch/accept', requireAuth, requireRole('vet'), asyncHandler(async (req, res) => {
  const vetId = await getVetIdForUser(req.user.sub);
  if (!vetId) return res.status(403).json({ error: 'Not a vet account' });

  // Accept is valid if this vet holds a LIVE offer row — the old check
  // against dispatch_offered_vet_id only ever recognised one vet, so a
  // job offered to several could not be accepted by anyone but the last
  // one written to that column.
  //
  // `assigned_vet_id IS NULL` makes this the race guard: when several
  // vets tap Accept at once, exactly one UPDATE matches and the rest
  // return no rows and are told the job has gone.
  const { rows } = await query(
    `UPDATE jobs SET assigned_vet_id = $1, status = 'assigned', dispatch_state = 'accepted',
       dispatch_offered_vet_id = $1, dispatch_expires_at = NULL, updated_at = now()
     WHERE id = $2
       AND assigned_vet_id IS NULL
       AND status NOT IN ('completed', 'cancelled')
       AND EXISTS (
         SELECT 1 FROM vet_job_offers o
         WHERE o.job_id = $2 AND o.vet_id = $1 AND o.outcome IN ('offered', 'proposed')
       )
     RETURNING *`,
    [vetId, req.params.id]
  );
  if (!rows[0]) {
    return res.status(409).json({ error: 'This job has already been taken, or the offer has expired.' });
  }
  await recordOfferOutcome(req.params.id, vetId, 'accepted');
  // Everyone else's offer is now dead — close them so the job stops
  // showing in their list.
  await query(
    `UPDATE vet_job_offers SET outcome = 'withdrawn', responded_at = now()
     WHERE job_id = $1 AND vet_id <> $2 AND outcome IN ('offered', 'proposed')`,
    [req.params.id, vetId]
  );

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
    // Prefer the PERSONALISED template, which names the attending vet.
    // It falls back to the generic wording only because
    // clientVetAssignedNamed has no flowId configured yet — so as soon
    // as that flow exists in MSG91, clients start getting the vet's name
    // with no code change. Previously the generic version was the ONLY
    // path, which is why the client was told a vet was assigned without
    // being told who.
    if (isTemplateConfigured('clientVetAssignedNamed')) {
      sendTemplatedSms(job.client_phone, 'clientVetAssignedNamed', {
        client_name: job.client_name,
        vet_name: vetUser?.full_name || 'your vet',
        pet_name: job.pet_name,
        ...smsDateVars(job),
      }).catch((err) => console.error('Vet-assigned SMS (named, to client) failed:', err.message));
    } else if (isTemplateConfigured('clientVetAssignedGeneric')) {
      sendTemplatedSms(job.client_phone, 'clientVetAssignedGeneric', {}).catch(
        (err) => console.error('Vet-assigned SMS (to client) failed:', err.message)
      );
    }

    // The journey link goes out HERE, not at booking. This is the first
    // moment the booking is real — a vet has agreed to attend — so it's
    // also the first point at which asking the client for consent and
    // payment is appropriate. Sending it earlier would have asked them
    // to pay for a visit nobody had committed to.
    sendJourneyLink(job).catch((err) => console.error('Journey link send failed:', err.message));
  }

  res.json({ job: rows[0] });
}));

// Vet declines — rolls to the next best match immediately.
router.post('/:id/dispatch/decline', requireAuth, requireRole('vet'), asyncHandler(async (req, res) => {
  const vetId = await getVetIdForUser(req.user.sub);
  if (!vetId) return res.status(403).json({ error: 'Not a vet account' });

  const { rows } = await query(
    `UPDATE jobs SET dispatch_declined_vet_ids = array_append(dispatch_declined_vet_ids, $1), updated_at = now()
     WHERE id = $2 AND EXISTS (
       SELECT 1 FROM vet_job_offers o
       WHERE o.job_id = $2 AND o.vet_id = $1 AND o.outcome IN ('offered', 'proposed')
     )
     RETURNING id`,
    [vetId, req.params.id]
  );
  if (!rows[0]) return res.status(409).json({ error: 'This offer is no longer available to you' });
  await recordOfferOutcome(req.params.id, vetId, 'declined', req.body?.reason);

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
  // Consent is a legal record for a euthanasia procedure. This route
  // previously had no role or ownership check at all, so any signed-in
  // vet could mark consent on ANY job by guessing/knowing its id.
  // Restricted to admin or the vet actually assigned to the job.
  const { rows: jobRows } = await query('SELECT assigned_vet_id FROM jobs WHERE id = $1', [req.params.id]);
  if (!jobRows[0]) return res.status(404).json({ error: 'Job not found' });

  if (req.user.role !== 'admin') {
    const myVetId = await getVetIdForUser(req.user.sub);
    if (!myVetId || jobRows[0].assigned_vet_id !== myVetId) {
      return res.status(403).json({ error: 'This job is not assigned to you.' });
    }
  }

  const { rows } = await query(`UPDATE jobs SET consent_signed = true, updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
  await logAction({ actorUserId: req.user.sub, action: 'consent_marked_signed', targetType: 'job', targetId: req.params.id });
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


// ========================================================================
// JOB LIFECYCLE ==========================================================
// ========================================================================

router.post('/:id/en-route', outboundMessageLimiter, requireAuth, requireRole('vet'), asyncHandler(async (req, res) => {
  // Location is now OPTIONAL. It sharpens the ETA when available, but
  // demanding it meant a vet who declined the location prompt — or whose
  // phone lost GPS — could not tell anyone they were on the way.
  const parsed = enRouteSchema.safeParse(req.body || {});
  const lat = parsed.success ? parsed.data.lat : null;
  const lng = parsed.success ? parsed.data.lng : null;
  // A vet can state their own ETA. They know the drive; the map is a
  // convenience, not the source of truth.
  const manualEta = Number(req.body?.etaMinutes);

  const vetId = await getVetIdForUser(req.user.sub);
  if (!vetId) return res.status(403).json({ error: 'Not a vet account' });

  const { rows: jobRows } = await query('SELECT * FROM jobs WHERE id = $1 AND assigned_vet_id = $2', [req.params.id, vetId]);
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Job not found, or not assigned to you' });
  // Three ways to get an ETA, in order of preference. Previously this
  // returned 422 when the job had no coordinates — and NO job has
  // coordinates, because they're only ever set by Maps address
  // autocomplete, which is dead while the API key is invalid. So "On my
  // way" failed for every vet on every job.
  let etaMinutes = null;
  let distanceText = null;

  if (Number.isFinite(manualEta) && manualEta > 0 && manualEta <= 480) {
    // 1. The vet told us. Most reliable — they know the road.
    etaMinutes = Math.round(manualEta);
  } else if (lat != null && lng != null && job.lat != null && job.lng != null) {
    // 2. Driving time from the maps API, when everything is available.
    try {
      const eta = await getDrivingEta({ originLat: lat, originLng: lng, destLat: job.lat, destLng: job.lng });
      etaMinutes = eta.etaMinutes;
      distanceText = eta.distanceText;
    } catch (err) {
      // A maps outage must not block the vet from setting off.
      console.error('Driving ETA failed, continuing without it:', err.message);
    }
  }
  // 3. Neither — the client is still told a vet is on the way, which is
  // the part that actually matters to them.

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
        // Link included so the estimate stays checkable. The SMS is a
        // snapshot from one moment; without a link the client's only way
        // to find out more is to phone someone who is currently driving.
        // Only mention a time when we actually have one. Without this
        // guard a null ETA reads as "arrive in about null minutes",
        // which is worse than saying nothing.
        message: `Hi ${job.client_name}, ${vetName} is on the way to see ${job.pet_name}`
          + (etaMinutes
            ? ` and expects to arrive in about ${etaMinutes} minute${etaMinutes === 1 ? '' : 's'}.`
            : '.')
          + `${process.env.CLIENT_APP_URL ? ` Track it here: ${process.env.CLIENT_APP_URL}/${job.client_token}` : ''}`,
      });
      smsSent = true;
    } catch (err) {
      console.error('En-route SMS to client failed:', err.message);
    }
  }

  notifyAdmins({
    category: 'job',
    title: 'Vet en route',
    body: `${vetName} is on the way to ${job.pet_name} (${job.job_number})`
      + (etaMinutes ? ` — ETA ${etaMinutes} min.` : '.'),
    url: `/jobs/${job.id}`,
  }).catch((err) => console.error('Admin en-route push failed:', err.message));
  sendSlackMessage(
    `🚗 *${vetName}* is on the way to see *${job.pet_name}* (${job.job_number})`
    + (etaMinutes ? ` — ETA ${etaMinutes} min.` : '.')
  )
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


// ========================================================================
// NOTES & INTERNAL MESSAGES ==============================================
// ========================================================================

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
    notifyAdmins({ title: `New message — ${job.pet_name}`, body: body.trim().slice(0, 120), url: `/jobs/${job.id}`, category: 'message' })
      .catch((err) => console.error('Admin message push failed:', err.message));
    sendSlackMessage(`💬 New message on *${job.pet_name}* (${job.job_number}) from the vet: "${body.trim().slice(0, 200)}"`)
      .catch((err) => console.error('Slack notify for message failed:', err.message));
  }

  res.status(201).json({ message: withSender[0] });
}));


// --- Refunds ---

const refundSchema = z.object({
  // Omit to refund the full remaining amount.
  amount: z.number().positive().optional(),
  reason: z.string().trim().max(500).optional().nullable(),
  /**
   * true  -> record only; money was returned by other means (bank
   *          transfer, cash) and eWay is NOT contacted.
   * false -> attempt the refund through eWay.
   *
   * Explicit rather than inferred, because "we already refunded them
   * manually" and "please actually move the money" must never be
   * confused — getting that wrong either double-refunds a client or
   * leaves them out of pocket.
   */
  manual: z.boolean().optional().default(false),
});

router.post('/:id/refund', outboundMessageLimiter, requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = refundSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid refund' });
  }

  const { rows: jobRows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.payment_status !== 'paid') {
    return res.status(409).json({ error: 'This job has no completed payment to refund.' });
  }

  // The original successful charge — refunds reference it, and eWay can
  // only refund against a transaction it processed.
  const { rows: chargeRows } = await query(
    `SELECT * FROM payments
     WHERE job_id = $1 AND status = 'succeeded'
     ORDER BY created_at DESC LIMIT 1`,
    [req.params.id]
  );
  const charge = chargeRows[0];
  if (!charge) {
    return res.status(409).json({ error: 'No successful payment found for this job.' });
  }

  const alreadyRefunded = Number(job.refunded_amount) || 0;
  const remaining = Math.round((Number(charge.amount) - alreadyRefunded) * 100) / 100;
  if (remaining <= 0) {
    return res.status(409).json({ error: 'This payment has already been fully refunded.' });
  }

  const amount = parsed.data.amount ?? remaining;
  if (amount > remaining) {
    return res.status(400).json({
      error: `Only $${remaining.toFixed(2)} remains refundable on this payment.`,
    });
  }

  let refundTransactionId = null;
  let responseMessage = 'Recorded manually by admin';

  if (!parsed.data.manual) {
    if (!isEwayConfigured()) {
      return res.status(503).json({
        error: 'Payment gateway is not configured. Refund the client directly, then record it here as a manual refund.',
      });
    }
    const result = await refundTransaction({
      transactionId: charge.provider_transaction_id,
      amountDollars: amount,
      invoiceReference: job.job_number,
    });
    if (!result.success) {
      // Nothing is written on failure — recording a refund that didn't
      // happen is worse than not recording one.
      return res.status(402).json({ error: `Refund declined: ${result.responseMessage}` });
    }
    refundTransactionId = result.refundTransactionId;
    responseMessage = result.responseMessage;
  }

  // Ledger stays append-only: a refund is its own row, never a mutation
  // of the original charge.
  await query(
    `INSERT INTO payments
       (job_id, amount, provider, provider_transaction_id, status, response_message,
        processed_by_user_id, refunds_payment_id, is_manual)
     VALUES ($1, $2, $3, $4, 'refunded', $5, $6, $7, $8)`,
    [
      req.params.id,
      -amount, // negative: the ledger sums to the net position
      parsed.data.manual ? 'manual' : 'eway',
      refundTransactionId,
      responseMessage,
      req.user.sub,
      charge.id,
      parsed.data.manual,
    ]
  );

  const totalRefunded = Math.round((alreadyRefunded + amount) * 100) / 100;
  const fullyRefunded = totalRefunded >= Number(charge.amount);

  await query(
    `UPDATE jobs
     SET refunded_amount = $1,
         refunded_at = now(),
         refund_reason = COALESCE($2, refund_reason),
         -- Only a FULL refund flips payment_status; a partial refund
         -- leaves the job paid, because money is still held.
         payment_status = CASE WHEN $3 THEN 'refunded'::job_payment_status ELSE payment_status END,
         updated_at = now()
     WHERE id = $4`,
    [totalRefunded, parsed.data.reason || null, fullyRefunded, req.params.id]
  );

  await logAction({
    actorUserId: req.user.sub,
    action: parsed.data.manual ? 'refund_recorded_manually' : 'refund_processed',
    targetType: 'job',
    targetId: req.params.id,
    metadata: { amount, totalRefunded, fullyRefunded, reason: parsed.data.reason },
  });

  notifyAdmins({
    title: 'Refund processed',
    body: `${job.pet_name} (${job.job_number}) — $${amount.toFixed(2)} refunded${fullyRefunded ? ' in full' : ' (partial)'}.`,
    url: `/jobs/${req.params.id}`,
    category: 'job',
    exceptUserId: req.user.sub,
  }).catch((e) => console.error('refund notify failed:', e.message));

  res.json({ ok: true, amount, totalRefunded, fullyRefunded });
}));


/**
 * GET /jobs/:id/dispatch-debug
 *
 * Why did (or didn't) this job get offered to anyone?
 *
 * Dispatch silently producing no offer is close to undiagnosable from
 * the outside: the job simply sits there and the vet sees nothing. This
 * returns every active vet with their score and the specific reasons,
 * so "no offers" becomes a readable answer rather than a mystery.
 */
router.get('/:id/dispatch-debug', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const vetsWithContext = await getVetsWithContextForJob(job);
  const declined = job.dispatch_declined_vet_ids || [];
  const ranked = rankVets(job, vetsWithContext);

  const candidates = ranked.map((r) => {
    const excludedReasons = [];
    if (declined.includes(r.vetId)) excludedReasons.push('already declined this job');
    if (r.score <= -150) excludedReasons.push(`score ${r.score} is below the -150 cutoff`);
    if (r.conflict) excludedReasons.push('already booked at a clashing time');
    if (!r.available) excludedReasons.push('not available at this date/time');
    return {
      vetId: r.vetId,
      name: r.name,
      score: r.score,
      territory: r.label,
      available: r.available,
      conflict: r.conflict,
      activeJobCount: r.activeJobCount,
      eligible: excludedReasons.length === 0 || (!declined.includes(r.vetId) && r.score > -150),
      excludedReasons,
    };
  });

  const offerable = ranked.filter((r) => !declined.includes(r.vetId) && r.score > -150);

  res.json({
    job: {
      id: job.id,
      jobNumber: job.job_number,
      status: job.status,
      dispatchState: job.dispatch_state,
      offeredVetId: job.dispatch_offered_vet_id,
      dispatchExpiresAt: job.dispatch_expires_at,
      assignedVetId: job.assigned_vet_id,
      postcode: job.postcode,
      // No coordinates means territory polygons can't be used at all and
      // matching falls back to postcodes — a common cause of "nobody
      // matched" when the address was typed manually.
      hasCoordinates: job.lat != null && job.lng != null,
    },
    activeVetsConsidered: vetsWithContext.length,
    declinedVetIds: declined,
    wouldOfferTo: offerable[0]?.name || null,
    summary: vetsWithContext.length === 0
      ? 'No active vets exist, so nothing can be offered.'
      : offerable.length === 0
        ? 'Every vet was excluded — see excludedReasons below.'
        : job.dispatch_state === 'accepted'
          ? 'This job was assigned directly by admin, so it never went through the offer process.'
          : `${offerable.length} vet(s) could be offered this job.`,
    candidates,
  });
}));


// --- Offers to one or more vets ---

const offerSchema = z.object({
  vetIds: z.array(z.string().uuid()).min(1, 'Choose at least one vet.'),
  expiryMinutes: z.number().int().min(5).max(1440).optional(),
});

/**
 * POST /jobs/:id/offer — offer a job to one or several vets at once.
 *
 * Unlike auto-dispatch, which offers to the single best-ranked vet and
 * rolls onward, this puts the job in front of everyone chosen
 * simultaneously and the first to accept takes it. That's faster when a
 * job needs covering, and it stops a job being invisible to vets who
 * could have taken it.
 */
router.post('/:id/offer', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = offerSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid offer' });
  }

  const { rows: jobRows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'cancelled') return res.status(409).json({ error: 'This job is cancelled.' });
  if (job.assigned_vet_id) {
    return res.status(409).json({ error: 'A vet has already accepted this job. Reassign instead.' });
  }

  const minutes = parsed.data.expiryMinutes ?? Number(process.env.DISPATCH_TIMEOUT_MINUTES || 30);
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

  const { rows: vets } = await query(
    `SELECT v.id, u.id AS user_id, u.full_name, u.is_active
     FROM vets v JOIN users u ON u.id = v.user_id
     WHERE v.id = ANY($1::uuid[]) AND u.is_active = true`,
    [parsed.data.vetIds]
  );
  if (vets.length === 0) {
    return res.status(400).json({ error: 'None of those vets are available.' });
  }

  for (const vet of vets) {
    // Supersede any live offer to this vet for this job rather than
    // stacking duplicates, so "offers" always means one row per vet.
    await query(
      `UPDATE vet_job_offers SET outcome = 'withdrawn', responded_at = now()
       WHERE job_id = $1 AND vet_id = $2 AND outcome IN ('offered', 'proposed')`,
      [req.params.id, vet.id]
    );
    await query(
      `INSERT INTO vet_job_offers (job_id, vet_id, outcome, expires_at)
       VALUES ($1, $2, 'offered', $3)`,
      [req.params.id, vet.id, expiresAt]
    );

    notifyUser(vet.user_id, {
      title: 'New job offer',
      body: `${job.pet_name} in ${job.suburb || job.postcode} on ${job.job_date} at ${job.job_time}.`,
      url: `/offers`,
      category: 'job',
    }).catch((e) => console.error('offer notify failed:', e.message));
  }

  await query(
    `UPDATE jobs SET dispatch_state = 'offered', dispatch_expires_at = $1, updated_at = now()
     WHERE id = $2`,
    [expiresAt, req.params.id]
  );

  await logAction({
    actorUserId: req.user.sub,
    action: 'job_offered_to_vets',
    targetType: 'job',
    targetId: req.params.id,
    metadata: { vetCount: vets.length, expiresAt },
  });

  res.json({ ok: true, offeredTo: vets.map((v) => v.full_name), expiresAt });
}));


const proposeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Choose a time.'),
  note: z.string().trim().max(500).optional().nullable(),
});

/**
 * POST /jobs/:id/offer/propose-time
 *
 * A vet who can't make the requested time can suggest another instead of
 * declining outright. Deliberately does NOT change the booking: the
 * client may have arranged family around the original time, so admin has
 * to agree it with them first. The offer stays live so the vet can still
 * be given it if the client accepts.
 */
router.post('/:id/offer/propose-time', requireAuth, requireRole('vet'), asyncHandler(async (req, res) => {
  const parsed = proposeSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid proposal' });
  }
  const myVetId = await getVetIdForUser(req.user.sub);
  if (!myVetId) return res.status(403).json({ error: 'Not a vet account' });

  const { rows } = await query(
    `UPDATE vet_job_offers
     SET outcome = 'proposed', responded_at = now(),
         response_seconds = EXTRACT(EPOCH FROM (now() - offered_at))::int,
         proposed_date = $1, proposed_time = $2, proposal_note = $3
     WHERE job_id = $4 AND vet_id = $5 AND outcome IN ('offered', 'proposed')
     RETURNING id`,
    [parsed.data.date, parsed.data.time, parsed.data.note || null, req.params.id, myVetId]
  );
  if (!rows[0]) return res.status(409).json({ error: 'This offer is no longer open.' });

  const { rows: jobRows } = await query('SELECT job_number, pet_name FROM jobs WHERE id = $1', [req.params.id]);
  const { rows: meRows } = await query('SELECT full_name FROM users WHERE id = $1', [req.user.sub]);

  notifyAdmins({
    title: 'Vet proposed a different time',
    body: `${meRows[0]?.full_name} can do ${jobRows[0]?.pet_name} (${jobRows[0]?.job_number}) on `
      + `${parsed.data.date} at ${parsed.data.time}`
      + `${parsed.data.note ? ` — ${parsed.data.note}` : ''}`,
    url: `/jobs/${req.params.id}`,
    category: 'job',
  }).catch((e) => console.error('proposal notify failed:', e.message));

  await logAction({
    actorUserId: req.user.sub,
    action: 'offer_time_proposed',
    targetType: 'job',
    targetId: req.params.id,
    metadata: { date: parsed.data.date, time: parsed.data.time },
  });

  res.json({ ok: true });
}));

/**
 * GET /jobs/:id/offer-status — who was offered this job and what they said.
 */
router.get('/:id/offer-status', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT o.id AS offer_id, o.outcome, o.offered_at, o.responded_at, o.expires_at,
            o.proposed_date, o.proposed_time, o.proposal_note,
            u.full_name AS vet_name, v.id AS vet_id
     FROM vet_job_offers o
     JOIN vets v ON v.id = o.vet_id
     JOIN users u ON u.id = v.user_id
     WHERE o.job_id = $1
     ORDER BY o.offered_at DESC`,
    [req.params.id]
  );
  res.json({ offers: rows });
}));


const updateJobSchema = z.object({
  clientName: z.string().trim().min(1).optional(),
  clientPhone: z.string().trim().min(1).optional(),
  clientEmail: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().email().nullable().optional()
  ),
  address: z.string().trim().min(1).optional(),
  suburb: z.string().trim().optional().nullable(),
  postcode: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  petName: z.string().trim().min(1).optional(),
  petType: z.string().trim().min(1).optional(),
  petBreed: z.string().trim().optional().nullable(),
  petWeight: z.string().trim().optional().nullable(),
  petAge: z.string().trim().optional().nullable(),
  serviceType: z.enum(['euthanasia_only', 'private_cremation', 'communal_cremation']).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  // Empty string clears the window back to a fixed time.
  timeEnd: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal('')]).optional().nullable(),
  handlingHelp: z.enum(['not_needed', 'client_helps', 'direct_pickup', 'needs_help', 'assistant']).optional(),
  pace: z.enum(['slow', 'normal', 'quick']).optional(),
  handlingNotes: z.string().trim().max(1000).optional().nullable(),
});

/**
 * PUT /jobs/:id — amend a booking.
 *
 * Bookings were immutable once created: a wrong address, a corrected
 * phone number or a client moving the time all meant cancelling and
 * re-keying the whole job, which loses its history, its consent and its
 * payment.
 *
 * Changing the DATE or TIME withdraws any live offers and notifies an
 * assigned vet, because they agreed to a specific slot — silently moving
 * a job under a vet who has already committed is how someone ends up at
 * the wrong door.
 */
router.put('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = updateJobSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid update' });
  }
  const d = parsed.data;

  const { rows: before } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = before[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'completed') {
    return res.status(409).json({ error: 'This job is complete and can no longer be edited.' });
  }

  const newDate = d.date || String(job.job_date).slice(0, 10);
  const newTime = d.time || String(job.job_time).slice(0, 5);
  const timeChanged =
    (d.date && d.date !== String(job.job_date).slice(0, 10))
    || (d.time && d.time !== String(job.job_time).slice(0, 5));

  // Recompute the rate band — moving a weekday booking to a Sunday
  // changes what the client pays and what the vet earns, and leaving a
  // stale category would quietly bill the wrong amount.
  const timeCategory = suggestTimeCategory(newDate, newTime);

  const { rows } = await query(
    `UPDATE jobs SET
       client_name   = COALESCE($1, client_name),
       client_phone  = COALESCE($2, client_phone),
       client_email  = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE client_email END,
       address       = COALESCE($4, address),
       suburb        = COALESCE($5, suburb),
       postcode      = COALESCE($6, postcode),
       state         = COALESCE($7, state),
       pet_name      = COALESCE($8, pet_name),
       pet_type      = COALESCE($9, pet_type),
       pet_breed     = COALESCE($10, pet_breed),
       pet_weight    = COALESCE($11, pet_weight),
       pet_age       = COALESCE($12, pet_age),
       service_type  = COALESCE($13::job_service_type, service_type),
       job_date      = COALESCE($14::date, job_date),
       job_time      = COALESCE($15::time, job_time),
       -- '' clears the window; NULL leaves it unchanged.
       job_time_end  = CASE WHEN $16::text = '' THEN NULL
                            WHEN $16::text IS NOT NULL THEN $16::time
                            ELSE job_time_end END,
       time_category = $17::job_time_category,
       notes         = CASE WHEN $18::text IS NOT NULL THEN $18 ELSE notes END,
       handling_help = COALESCE($19, handling_help),
       pace          = COALESCE($20, pace),
       handling_notes = CASE WHEN $21::text IS NOT NULL THEN $21 ELSE handling_notes END,
       updated_at    = now()
     WHERE id = $22
     RETURNING *`,
    [
      d.clientName ?? null, d.clientPhone ?? null, d.clientEmail ?? null,
      d.address ?? null, d.suburb ?? null, d.postcode ?? null, d.state ?? null,
      d.petName ?? null, d.petType ?? null, d.petBreed ?? null, d.petWeight ?? null, d.petAge ?? null,
      d.serviceType ?? null,
      d.date ?? null, d.time ?? null, d.timeEnd ?? null,
      timeCategory,
      d.notes ?? null,
      d.handlingHelp ?? null, d.pace ?? null, d.handlingNotes ?? null,
      req.params.id,
    ]
  );

  await logAction({
    actorUserId: req.user.sub,
    action: 'job_updated',
    targetType: 'job',
    targetId: req.params.id,
    metadata: { fields: Object.keys(d), timeChanged },
  });

  if (timeChanged) {
    // Live offers were for the OLD slot, so they're no longer what the
    // vet agreed to consider.
    await query(
      `UPDATE vet_job_offers SET outcome = 'withdrawn', responded_at = now()
       WHERE job_id = $1 AND outcome IN ('offered', 'proposed')`,
      [req.params.id]
    );

    if (job.assigned_vet_id) {
      const { rows: vetRows } = await query(
        'SELECT u.id AS user_id FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1',
        [job.assigned_vet_id]
      );
      if (vetRows[0]) {
        notifyUser(vetRows[0].user_id, {
          title: 'Booking time changed',
          body: `${job.pet_name} (${job.job_number}) has moved to ${newDate} at ${newTime}.`,
          url: `/jobs/${req.params.id}`,
          category: 'job',
        }).catch((e) => console.error('time change notify failed:', e.message));
      }
    }
  }

  res.json({ job: rows[0], offersWithdrawn: timeChanged });
}));

/**
 * POST /jobs/:id/offer/:offerId/accept-proposal
 *
 * Take a vet up on the alternative time they suggested: move the job to
 * that slot and give it to them.
 *
 * One action rather than "edit the time, then re-offer, then wait for
 * them to accept again" — the vet has already said they can do it, so
 * asking them to confirm twice is just latency. Admin is expected to
 * have cleared it with the client first, which the UI states.
 */
router.post('/:id/offer/:offerId/accept-proposal', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows: offerRows } = await query(
    `SELECT o.*, u.id AS user_id, u.full_name
     FROM vet_job_offers o
     JOIN vets v ON v.id = o.vet_id
     JOIN users u ON u.id = v.user_id
     WHERE o.id = $1 AND o.job_id = $2 AND o.outcome = 'proposed'`,
    [req.params.offerId, req.params.id]
  );
  const offer = offerRows[0];
  if (!offer) return res.status(404).json({ error: 'That suggestion is no longer available.' });

  const newDate = String(offer.proposed_date).slice(0, 10);
  const newTime = String(offer.proposed_time).slice(0, 5);
  const timeCategory = suggestTimeCategory(newDate, newTime);

  const { rows } = await query(
    `UPDATE jobs SET job_date = $1, job_time = $2, time_category = $3,
       assigned_vet_id = $4, status = 'assigned', dispatch_state = 'accepted',
       dispatch_offered_vet_id = $4, dispatch_expires_at = NULL, updated_at = now()
     WHERE id = $5 AND assigned_vet_id IS NULL
     RETURNING *`,
    [newDate, newTime, timeCategory, offer.vet_id, req.params.id]
  );
  if (!rows[0]) {
    return res.status(409).json({ error: 'This job already has a vet assigned.' });
  }

  await query(
    `UPDATE vet_job_offers SET outcome = 'accepted', responded_at = now() WHERE id = $1`,
    [req.params.offerId]
  );
  // Everyone else's offer was for the old time and is now moot.
  await query(
    `UPDATE vet_job_offers SET outcome = 'withdrawn', responded_at = now()
     WHERE job_id = $1 AND id <> $2 AND outcome IN ('offered', 'proposed')`,
    [req.params.id, req.params.offerId]
  );

  await logAction({
    actorUserId: req.user.sub,
    action: 'offer_proposal_accepted',
    targetType: 'job',
    targetId: req.params.id,
    metadata: { vetId: offer.vet_id, newDate, newTime },
  });

  notifyUser(offer.user_id, {
    title: 'Your suggested time was accepted',
    body: `${rows[0].pet_name} (${rows[0].job_number}) is confirmed for ${newDate} at ${newTime}.`,
    url: `/jobs/${req.params.id}`,
    category: 'job',
  }).catch((e) => console.error('proposal accept notify failed:', e.message));

  // The booking is real now, so the client gets their journey link —
  // same trigger as a normal acceptance.
  sendJourneyLink(rows[0]).catch((e) => console.error('journey link failed:', e.message));

  res.json({ job: rows[0] });
}));

/**
 * GET /jobs/:id/consent.pdf — the signed consent, for admin or the
 * assigned vet. Same document the client receives.
 */
router.get('/:id/consent.pdf', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!(await canAccessRecord(req, job))) return res.status(403).json({ error: 'Not your job' });
  if (!job.consent_signed) return res.status(409).json({ error: 'Consent has not been signed yet.' });

  let vet = {};
  let vetName = null;
  if (job.assigned_vet_id) {
    const { rows: vetRows } = await query(
      `SELECT u.full_name, u.email, u.phone, v.abn, v.reg_number, v.reg_state
       FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
      [job.assigned_vet_id]
    );
    vet = vetRows[0] || {};
    vetName = vet.full_name || null;
  }

  const { rows: contentRows } = await query('SELECT config FROM content_settings WHERE id = true');
  const content = contentRows[0].config;
  // Resolve the pet FIRST — the consent wording depends on it, and
  // const isn't hoisted, so reading it above its declaration throws.
  const jobPets = await getPets(job.id);
  const idx = req.query.petId ? jobPets.findIndex((p) => p.id === req.query.petId) : 0;
  if (idx === -1) return res.status(404).json({ error: 'That pet is not on this booking.' });
  const chosenPet = jobPets[idx] || null;

  const consentText = (content.consentTemplate || '')
    .replaceAll('{vetName}', vetName || 'your vet')
    // The pet this form actually covers, not the job's mirrored first
    // pet — otherwise every document on a multi-pet visit names the
    // same animal.
    .replaceAll('{petName}', chosenPet?.name || job.pet_name || '')
    .replaceAll('{clientName}', job.client_name || '');

  res.setHeader('Content-Type', 'application/pdf');
  const { rows: petSig } = chosenPet
    ? await query('SELECT consent_signature_image FROM job_pets WHERE id = $1', [chosenPet.id])
    : { rows: [] };

  res.setHeader('Content-Disposition', `inline; filename="${consentFilename(job, chosenPet)}"`);
  generateConsentPdf({
    res, job, vet, company: content.company || {},
    consentText,
    pet: chosenPet,
    petIndex: idx + 1,
    petCount: jobPets.length,
    signatureImage: petSig[0]?.consent_signature_image || job.consent_signature_image || null,
  });
}));


// --- Pets on a job ---

const petSchema = z.object({
  name: z.string().trim().min(1, 'The pet needs a name.'),
  species: z.string().trim().optional().nullable(),
  breed: z.string().trim().optional().nullable(),
  weight: z.string().trim().optional().nullable(),
  age: z.string().trim().optional().nullable(),
  behaviour: z.string().trim().optional().nullable(),
  serviceType: z.enum(['euthanasia_only', 'private_cremation', 'communal_cremation']).optional().nullable(),
});


// ========================================================================
// PETS & CONSENT =========================================================
// ========================================================================

router.get('/:id/pets', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  if (!(await canAccessRecord(req, rows[0]))) return res.status(403).json({ error: 'Not your job' });
  res.json({ pets: await getPets(req.params.id) });
}));

/**
 * POST /jobs/:id/pets — add another pet to an existing booking.
 *
 * Families sometimes say goodbye to two or three animals in one visit.
 * Previously that meant separate bookings for the same address and time,
 * which double-dispatches and double-charges.
 */
router.post('/:id/pets', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = petSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid pet' });
  }
  const { rows: jobRows } = await query('SELECT id, status, service_type FROM jobs WHERE id = $1', [req.params.id]);
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'completed') {
    return res.status(409).json({ error: 'This job is complete and can no longer be changed.' });
  }

  const { rows: existing } = await query(
    'SELECT COALESCE(MAX(sort_order), -1) AS max FROM job_pets WHERE job_id = $1',
    [req.params.id]
  );

  const d = parsed.data;
  const { rows } = await query(
    `INSERT INTO job_pets (job_id, name, species, breed, weight, age, behaviour, service_type, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      req.params.id, d.name, d.species || null, d.breed || null, d.weight || null,
      d.age || null, d.behaviour || 'Friendly',
      // Defaults to the job's service type — most families choose the
      // same for both — but stays per-pet so it can differ.
      d.serviceType || job.service_type,
      Number(existing[0].max) + 1,
    ]
  );

  // Adding an unconsented pet makes the JOB no longer fully consented,
  // which is correct: there is now a form outstanding.
  await syncPrimaryPet(req.params.id);

  await logAction({
    actorUserId: req.user.sub, action: 'job_pet_added',
    targetType: 'job', targetId: req.params.id, metadata: { petName: d.name },
  });

  res.status(201).json({ pet: rows[0] });
}));

router.put('/:id/pets/:petId', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = petSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid pet' });
  }
  const d = parsed.data;
  const { rows } = await query(
    `UPDATE job_pets SET name=$1, species=$2, breed=$3, weight=$4, age=$5,
       behaviour=$6, service_type=COALESCE($7::job_service_type, service_type)
     WHERE id=$8 AND job_id=$9 RETURNING *`,
    [d.name, d.species || null, d.breed || null, d.weight || null, d.age || null,
     d.behaviour || 'Friendly', d.serviceType || null, req.params.petId, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Pet not found on this job' });

  await syncPrimaryPet(req.params.id);
  res.json({ pet: rows[0] });
}));

router.delete('/:id/pets/:petId', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const pets = await getPets(req.params.id);
  // A job must always have at least one pet — jobs.pet_* mirrors the
  // first, and an empty list would leave those columns stale while the
  // job still appears everywhere as that animal.
  if (pets.length <= 1) {
    return res.status(409).json({
      error: 'A booking must have at least one pet. Cancel the job instead.',
    });
  }
  const target = pets.find((p) => p.id === req.params.petId);
  if (target?.consent_signed) {
    return res.status(409).json({
      error: 'Consent has been signed for this pet. Removing it would discard a signed record.',
    });
  }

  await query('DELETE FROM job_pets WHERE id = $1 AND job_id = $2', [req.params.petId, req.params.id]);
  await syncPrimaryPet(req.params.id);

  await logAction({
    actorUserId: req.user.sub, action: 'job_pet_removed',
    targetType: 'job', targetId: req.params.id, metadata: { petId: req.params.petId },
  });
  res.json({ ok: true });
}));


const nudgeSchema = z.object({
  kind: z.enum(['finalise', 'review']),
});

/**
 * POST /jobs/:id/nudge — text the client a link, now.
 *
 * The workers already chase automatically, but they run on a schedule
 * and only once. Admin often knows something the schedule doesn't: the
 * family just rang, or the visit is tomorrow and consent still isn't
 * signed. This is the manual equivalent.
 *
 * Two kinds, because they say different things:
 *   finalise — consent and/or payment are outstanding BEFORE the visit
 *   review   — the visit is done; asking how it went
 */
router.post('/:id/nudge', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = nudgeSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Choose what to send.' });

  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.client_phone) {
    return res.status(400).json({ error: 'This client has no phone number on file.' });
  }

  const link = `${process.env.CLIENT_APP_URL || ''}/${job.client_token}`;

  if (parsed.data.kind === 'review') {
    // Asking for a review before the visit has happened would be
    // appalling. The worker gates on this too; so must the manual path.
    if (job.status !== 'completed') {
      return res.status(409).json({
        error: "This visit isn't complete yet, so it's too early to ask for feedback.",
      });
    }
  } else {
    // Nothing outstanding means nothing to chase — sending "please
    // finalise" to someone who already has would just confuse them.
    const pets = await getPets(job.id);
    const unsigned = pets.filter((p) => !p.consent_signed).length;
    if (unsigned === 0 && job.payment_status === 'paid') {
      return res.status(409).json({
        error: 'Consent is signed and payment is received — there is nothing outstanding to chase.',
      });
    }
  }

  if (!isMsg91Configured()) {
    return res.status(503).json({ error: 'SMS is not configured, so nothing was sent.' });
  }

  const template = parsed.data.kind === 'review' ? 'clientReviewReminder' : 'genericMessage';
  const vars = parsed.data.kind === 'review'
    ? { client_name: job.client_name, pet_name: job.pet_name, link }
    : {
        message: `Hi ${job.client_name}, there are still a couple of steps to finish for `
          + `${job.pet_name}'s visit. You can complete them here: ${link}`,
      };

  if (!isTemplateConfigured(template)) {
    return res.status(503).json({
      error: `The ${template} SMS template isn't set up yet, so nothing was sent.`,
    });
  }

  try {
    await sendTemplatedSms(job.client_phone, template, vars);
  } catch (err) {
    // Surfaced, not swallowed. Admin pressed a button expecting a text
    // to go; telling them it worked when it didn't is how a client is
    // left waiting for a message that never arrives.
    return res.status(502).json({ error: `The text could not be sent: ${err.message}` });
  }

  // Recorded so a second click is a visible decision rather than an
  // accident — a grieving client should not get the same nudge twice
  // because two people were looking at the job.
  await query(
    `UPDATE jobs SET last_nudge_at = now(), last_nudge_kind = $1, updated_at = now() WHERE id = $2`,
    [parsed.data.kind, req.params.id]
  );
  await logAction({
    actorUserId: req.user.sub, action: 'client_nudged',
    targetType: 'job', targetId: req.params.id, metadata: { kind: parsed.data.kind },
  });

  res.json({ ok: true, sentTo: job.client_phone, kind: parsed.data.kind });
}));

export default router;
