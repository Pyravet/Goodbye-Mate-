import { Router } from 'express';
import { z } from 'zod';
import { query, pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logAction } from '../audit/log.js';
import { invoiceTotals, formatInvoiceNumber, dueDateFor } from '../domain/partnerInvoices.js';
import {
  generatePartnerInvoicePdf, generatePartnerInvoicePdfBuffer, partnerInvoiceFilename,
} from '../pdf/generatePartnerInvoice.js';
import { sendEmail, isEmailConfigured } from '../integrations/email/smtp.js';

const router = Router();

// Every route here is admin-only: these are the business's outgoing
// invoices to other companies, and vets have no reason to see them.
router.use(requireAuth, requireRole('admin'));

const itemSchema = z.object({
  description: z.string().trim().min(1, 'Each line needs a description.'),
  quantity: z.coerce.number().default(1),
  unitAmount: z.coerce.number().default(0),
  jobId: z.string().uuid().optional().nullable(),
});

const invoiceSchema = z.object({
  recipientName: z.string().trim().min(1, 'Who is this invoice for?'),
  recipientEmail: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().email('That email address is not valid.').nullable().optional()
  ),
  recipientAbn: z.string().trim().optional().nullable(),
  recipientAddress: z.string().trim().optional().nullable(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  // Chosen per invoice, because the right treatment genuinely differs
  // between partners and can differ between two invoices issued the
  // same day.
  gstMode: z.enum(['inclusive', 'exclusive', 'none']).optional(),
  gstPercent: z.coerce.number().min(0).max(100).optional(),
  items: z.array(itemSchema).default([]),
});

/** Company details and bank details, used for every document here. */
async function issuerDetails() {
  const { rows } = await query('SELECT config FROM content_settings WHERE id = true');
  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const content = rows[0]?.config || {};
  return {
    company: content.company || {},
    bank: content.bankDetails || {},
    // Default rate only. Whether an invoice CARRIES GST is now a
    // per-invoice choice — it used to be gated on the client-pricing
    // isGstRegistered flag, which defaults to false, so no partner
    // invoice ever showed GST regardless of the real registration.
    defaultGstPercent: Number(pricingRows[0]?.config?.gstPercent) || 10,
  };
}

async function loadInvoice(id) {
  const { rows } = await query('SELECT * FROM partner_invoices WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const { rows: items } = await query(
    'SELECT * FROM partner_invoice_items WHERE invoice_id = $1 ORDER BY sort_order',
    [id]
  );
  return { invoice: rows[0], items };
}

/** Replace an invoice's lines and re-total it. Drafts only. */
async function replaceItems(invoiceId, items, gstOpts) {
  const totals = invoiceTotals(items, gstOpts);
  await query('DELETE FROM partner_invoice_items WHERE invoice_id = $1', [invoiceId]);
  for (const [i, line] of totals.lines.entries()) {
    await query(
      `INSERT INTO partner_invoice_items
        (invoice_id, description, quantity, unit_amount, amount, job_id, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [invoiceId, line.description, line.quantity, line.unitAmount, line.amount, line.jobId || null, i]
    );
  }
  await query(
    `UPDATE partner_invoices SET subtotal=$1, gst=$2, total=$3, updated_at=now() WHERE id=$4`,
    [totals.subtotal, totals.gst, totals.total, invoiceId]
  );
  return totals;
}

// --- List & read ---

router.get('/', asyncHandler(async (req, res) => {
  const status = req.query.status;
  const params = [];
  let where = '';
  if (status && status !== 'all') {
    params.push(status);
    where = 'WHERE status = $1';
  }
  const { rows } = await query(
    `SELECT * FROM partner_invoices ${where} ORDER BY created_at DESC LIMIT 200`,
    params
  );
  const { rows: totals } = await query(
    `SELECT
       COALESCE(SUM(total) FILTER (WHERE status = 'sent'), 0) AS outstanding,
       COUNT(*) FILTER (WHERE status = 'sent')::int AS unpaid_count,
       COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0) AS paid_total
     FROM partner_invoices`
  );
  res.json({ invoices: rows, summary: totals[0] });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const found = await loadInvoice(req.params.id);
  if (!found) return res.status(404).json({ error: 'Invoice not found' });
  res.json(found);
}));

// --- Create & edit ---

router.post('/', asyncHandler(async (req, res) => {
  const parsed = invoiceSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid invoice' });
  }
  const d = parsed.data;
  const { defaultGstPercent } = await issuerDetails();
  const gstMode = d.gstMode || 'inclusive';
  const gstPercent = d.gstPercent ?? defaultGstPercent;

  const issueDate = d.issueDate
    || new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });

  const { rows } = await query(
    `INSERT INTO partner_invoices
       (recipient_name, recipient_email, recipient_abn, recipient_address,
        issue_date, due_date, notes, created_by, gst_mode, gst_percent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      d.recipientName, d.recipientEmail || null, d.recipientAbn || null, d.recipientAddress || null,
      issueDate,
      // Default terms rather than leaving it blank — an invoice with no
      // due date is one nobody chases.
      d.dueDate || dueDateFor(issueDate, 14),
      d.notes || null, req.user.sub, gstMode, gstPercent,
    ]
  );

  await replaceItems(rows[0].id, d.items, { gstMode, gstPercent });
  await logAction({
    actorUserId: req.user.sub, action: 'partner_invoice_created',
    targetType: 'partner_invoice', targetId: rows[0].id,
    metadata: { recipient: d.recipientName },
  });

  res.status(201).json(await loadInvoice(rows[0].id));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const parsed = invoiceSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid invoice' });
  }
  const found = await loadInvoice(req.params.id);
  if (!found) return res.status(404).json({ error: 'Invoice not found' });

  // Editing an issued invoice would change a document the recipient
  // already holds — and their copy would no longer match ours. Void it
  // and raise a new one instead.
  if (found.invoice.status !== 'draft') {
    return res.status(409).json({
      error: 'This invoice has already been issued. Void it and raise a new one instead of editing it.',
    });
  }

  const d = parsed.data;
  const { defaultGstPercent } = await issuerDetails();
  const gstMode = d.gstMode || found.invoice.gst_mode || 'inclusive';
  const gstPercent = d.gstPercent ?? Number(found.invoice.gst_percent) ?? defaultGstPercent;

  await query(
    `UPDATE partner_invoices SET recipient_name=$1, recipient_email=$2, recipient_abn=$3,
       recipient_address=$4, issue_date=COALESCE($5::date, issue_date), due_date=$6,
       notes=$7, gst_mode=$8, gst_percent=$9, updated_at=now()
     WHERE id=$10`,
    [d.recipientName, d.recipientEmail || null, d.recipientAbn || null, d.recipientAddress || null,
     d.issueDate || null, d.dueDate || null, d.notes || null, gstMode, gstPercent, req.params.id]
  );
  await replaceItems(req.params.id, d.items, { gstMode, gstPercent });
  res.json(await loadInvoice(req.params.id));
}));

// --- Issue, mark paid, void ---

/**
 * POST /:id/send — allocate a number, freeze the totals, optionally email.
 *
 * The number is allocated HERE rather than at creation, so a draft that
 * is edited or abandoned never consumes one. Gaps in an invoice series
 * are exactly what an auditor asks about.
 */
router.post('/:id/send', asyncHandler(async (req, res) => {
  const found = await loadInvoice(req.params.id);
  if (!found) return res.status(404).json({ error: 'Invoice not found' });
  if (found.invoice.status !== 'draft') {
    return res.status(409).json({ error: 'This invoice has already been issued.' });
  }
  if (found.items.length === 0) {
    return res.status(400).json({ error: 'Add at least one line before sending.' });
  }

  // RECOMPUTE before issuing. Totals were stored when the draft was
  // created, so a draft written before the business registered for GST
  // would be issued with $0 GST — under-billing the partner by an
  // eleventh and leaving the business short at BAS time. Send is the
  // moment this becomes a real document, so it is the moment the tax
  // treatment must be correct. AFTER this it is frozen for good.
  // Recompute using the INVOICE's own mode and rate — frozen from here.
  const gstOpts = {
    gstMode: found.invoice.gst_mode || 'inclusive',
    gstPercent: Number(found.invoice.gst_percent) || 10,
  };
  await replaceItems(req.params.id, found.items.map((i) => ({
    description: i.description,
    quantity: Number(i.quantity),
    unitAmount: Number(i.unit_amount),
    jobId: i.job_id,
  })), gstOpts);

  // Row-locked counter, same as RCTI numbering: two admins hitting send
  // at once must not be handed the same invoice number.
  const client = await pool.connect();
  let invoiceNumber;
  try {
    await client.query('BEGIN');
    const { rows: seq } = await client.query(
      'SELECT next_number FROM partner_invoice_sequence WHERE id = true FOR UPDATE'
    );
    invoiceNumber = formatInvoiceNumber(seq[0].next_number);
    await client.query('UPDATE partner_invoice_sequence SET next_number = next_number + 1 WHERE id = true');
    await client.query(
      `UPDATE partner_invoices SET invoice_number=$1, status='sent', sent_at=now(), updated_at=now()
       WHERE id=$2`,
      [invoiceNumber, req.params.id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await logAction({
    actorUserId: req.user.sub, action: 'partner_invoice_sent',
    targetType: 'partner_invoice', targetId: req.params.id,
    metadata: { invoiceNumber, total: found.invoice.total },
  });

  const updated = await loadInvoice(req.params.id);
  const { company, bank } = await issuerDetails();

  // Emailing is best-effort and reported honestly. The invoice IS issued
  // either way — telling admin it was emailed when it wasn't is how an
  // unpaid invoice goes unchased for a month.
  let emailed = false;
  let emailError = null;
  if (updated.invoice.recipient_email && isEmailConfigured()) {
    try {
      const pdf = await generatePartnerInvoicePdfBuffer({ ...updated, company, bank });
      await sendEmail({
        to: updated.invoice.recipient_email,
        subject: `Invoice ${invoiceNumber} from ${company.name || 'Goodbye Mate'}`,
        html: `<p>Please find invoice ${invoiceNumber} attached`
          + `${updated.invoice.due_date ? `, due ${updated.invoice.due_date}` : ''}.</p>`,
        attachments: [{ filename: partnerInvoiceFilename(updated.invoice), content: pdf }],
      });
      emailed = true;
    } catch (err) {
      emailError = err.message;
      console.error('Partner invoice email failed:', err.message);
    }
  } else if (!updated.invoice.recipient_email) {
    emailError = 'No email address on this invoice — download the PDF and send it manually.';
  } else {
    emailError = 'Email is not configured — download the PDF and send it manually.';
  }

  res.json({ ...updated, emailed, emailError });
}));

router.post('/:id/mark-paid', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE partner_invoices SET status='paid', paid_at=now(), updated_at=now()
     WHERE id=$1 AND status='sent' RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(409).json({ error: 'Only a sent invoice can be marked paid.' });
  await logAction({
    actorUserId: req.user.sub, action: 'partner_invoice_paid',
    targetType: 'partner_invoice', targetId: req.params.id,
  });
  res.json({ invoice: rows[0] });
}));

/**
 * POST /:id/void
 *
 * Voids rather than deletes. An issued invoice number must remain
 * accounted for — a missing number in the series looks like a hidden
 * transaction.
 */
router.post('/:id/void', asyncHandler(async (req, res) => {
  const reason = (req.body?.reason || '').trim() || null;
  const { rows } = await query(
    `UPDATE partner_invoices SET status='void', updated_at=now(),
       notes = COALESCE(notes || E'\\n\\n', '') || $1
     WHERE id=$2 AND status <> 'paid' RETURNING *`,
    [`VOIDED: ${reason || 'no reason given'}`, req.params.id]
  );
  if (!rows[0]) {
    return res.status(409).json({ error: 'A paid invoice cannot be voided. Raise a credit instead.' });
  }
  await logAction({
    actorUserId: req.user.sub, action: 'partner_invoice_voided',
    targetType: 'partner_invoice', targetId: req.params.id, metadata: { reason },
  });
  res.json({ invoice: rows[0] });
}));

// --- PDF ---

router.get('/:id/invoice.pdf', asyncHandler(async (req, res) => {
  const found = await loadInvoice(req.params.id);
  if (!found) return res.status(404).json({ error: 'Invoice not found' });
  const { company, bank } = await issuerDetails();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${partnerInvoiceFilename(found.invoice)}"`);
  generatePartnerInvoicePdf({ res, ...found, company, bank });
}));

export default router;
