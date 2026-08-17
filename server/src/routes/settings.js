import { Router } from 'express';
import { z } from 'zod';
import express from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAction } from '../audit/log.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Brochure PDFs need a bigger body-size allowance than the app-wide 1mb
// JSON limit — scoped to just this route rather than raising the global
// limit, since nothing else needs it.
const pdfBodyParser = express.json({ limit: '15mb' });

router.get('/pricing', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  res.json({ pricing: rows[0].config });
}));

router.put('/pricing', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const config = req.body;
  if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Invalid pricing config' });

  await query(
    'UPDATE pricing_settings SET config = $1, updated_at = now(), updated_by = $2 WHERE id = true',
    [JSON.stringify(config), req.user.sub]
  );
  await logAction({ actorUserId: req.user.sub, action: 'pricing_updated', targetType: 'settings' });
  res.json({ ok: true });
}));

router.get('/content', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT config FROM content_settings WHERE id = true');
  res.json({ content: rows[0].config });
}));

router.put('/content', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const config = req.body;
  if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Invalid content config' });

  await query(
    'UPDATE content_settings SET config = $1, updated_at = now(), updated_by = $2 WHERE id = true',
    [JSON.stringify(config), req.user.sub]
  );
  await logAction({ actorUserId: req.user.sub, action: 'content_updated', targetType: 'settings' });
  res.json({ ok: true });
}));

router.get('/templates', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT id, label, text FROM message_templates ORDER BY id');
  res.json({ templates: rows });
}));

const templateSchema = z.object({ label: z.string().min(1), text: z.string().min(1) });

router.put('/templates/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid template', details: parsed.error.flatten() });

  const { rows } = await query(
    `UPDATE message_templates SET label = $1, text = $2, updated_at = now() WHERE id = $3 RETURNING id`,
    [parsed.data.label, parsed.data.text, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Template not found' });

  await logAction({ actorUserId: req.user.sub, action: 'template_updated', targetType: 'message_template', targetId: req.params.id });
  res.json({ ok: true });
}));

// --- Cremation brochure PDFs ---
// kind is 'private_cremation' or 'communal_cremation', matching the
// job.service_type values (minus 'euthanasia_only', which has no
// cremation brochure).
const brochureKindSchema = z.enum(['private_cremation', 'communal_cremation']);

router.get('/content/brochure/:kind', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const kind = brochureKindSchema.safeParse(req.params.kind);
  if (!kind.success) return res.status(400).json({ error: 'Invalid brochure kind' });

  const { rows } = await query('SELECT filename, uploaded_at FROM content_documents WHERE kind = $1', [kind.data]);
  res.json({ document: rows[0] || null });
}));

const brochureUploadSchema = z.object({
  filename: z.string().min(1),
  dataBase64: z.string().min(1),
});

router.put('/content/brochure/:kind', requireAuth, requireRole('admin'), pdfBodyParser, asyncHandler(async (req, res) => {
  const kind = brochureKindSchema.safeParse(req.params.kind);
  if (!kind.success) return res.status(400).json({ error: 'Invalid brochure kind' });

  const parsed = brochureUploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid upload' });

  let buffer;
  try {
    buffer = Buffer.from(parsed.data.dataBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid file data' });
  }
  if (buffer.length === 0 || buffer.length > 12 * 1024 * 1024) {
    return res.status(400).json({ error: 'File must be a non-empty PDF under 12MB' });
  }
  // Quick sanity check it's actually a PDF (starts with %PDF) rather than
  // trusting the client-supplied filename/mime type alone.
  if (buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
    return res.status(400).json({ error: 'File does not look like a valid PDF' });
  }

  await query(
    `INSERT INTO content_documents (kind, filename, mime_type, data, uploaded_by)
     VALUES ($1, $2, 'application/pdf', $3, $4)
     ON CONFLICT (kind) DO UPDATE SET filename = EXCLUDED.filename, data = EXCLUDED.data, uploaded_at = now(), uploaded_by = EXCLUDED.uploaded_by`,
    [kind.data, parsed.data.filename, buffer, req.user.sub]
  );
  await logAction({ actorUserId: req.user.sub, action: 'brochure_pdf_uploaded', targetType: 'content_document', targetId: kind.data, metadata: { filename: parsed.data.filename } });
  res.json({ ok: true });
}));

router.delete('/content/brochure/:kind', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const kind = brochureKindSchema.safeParse(req.params.kind);
  if (!kind.success) return res.status(400).json({ error: 'Invalid brochure kind' });

  await query('DELETE FROM content_documents WHERE kind = $1', [kind.data]);
  await logAction({ actorUserId: req.user.sub, action: 'brochure_pdf_removed', targetType: 'content_document', targetId: kind.data });
  res.json({ ok: true });
}));

export default router;
