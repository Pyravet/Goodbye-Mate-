import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAction } from '../audit/log.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Brochure PDFs need a bigger body-size allowance than the app-wide 1mb
// JSON limit — scoped to just this route rather than raising the global
// limit, since nothing else needs it.

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

  const state = (req.query.state || 'ALL').toUpperCase();
  const { rows } = await query(
    'SELECT filename, state, uploaded_at FROM content_documents WHERE kind = $1 AND state = $2',
    [kind.data, state]
  );
  res.json({ document: rows[0] || null });
}));

// All brochures for a kind, across every state — powers the admin list.
router.get('/content/brochures/:kind', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const kind = brochureKindSchema.safeParse(req.params.kind);
  if (!kind.success) return res.status(400).json({ error: 'Invalid brochure kind' });

  const { rows } = await query(
    'SELECT filename, state, uploaded_at FROM content_documents WHERE kind = $1 ORDER BY state',
    [kind.data]
  );
  res.json({ documents: rows });
}));

const brochureUploadSchema = z.object({
  filename: z.string().min(1),
  dataBase64: z.string().min(1),
  // 'ALL' is the nationwide fallback used when a job's own state has no
  // brochure of its own.
  state: z.enum(['ALL', 'VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']).default('ALL'),
});

// Shared PDF validation — used by brochures and client resources alike.
function decodePdf(dataBase64) {
  let buffer;
  try {
    buffer = Buffer.from(dataBase64, 'base64');
  } catch {
    return { error: 'Invalid file data' };
  }
  if (buffer.length === 0 || buffer.length > 12 * 1024 * 1024) {
    return { error: 'File must be a non-empty PDF under 12MB' };
  }
  // Check the actual magic bytes rather than trusting the supplied
  // filename or mime type.
  if (buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
    return { error: 'File does not look like a valid PDF' };
  }
  return { buffer };
}

router.put('/content/brochure/:kind', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const kind = brochureKindSchema.safeParse(req.params.kind);
  if (!kind.success) return res.status(400).json({ error: 'Invalid brochure kind' });

  const parsed = brochureUploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid upload', details: parsed.error.flatten() });

  const { buffer, error } = decodePdf(parsed.data.dataBase64);
  if (error) return res.status(400).json({ error });

  await query(
    `INSERT INTO content_documents (kind, state, filename, mime_type, data, uploaded_by)
     VALUES ($1, $2, $3, 'application/pdf', $4, $5)
     ON CONFLICT (kind, state) DO UPDATE SET filename = EXCLUDED.filename, data = EXCLUDED.data, uploaded_at = now(), uploaded_by = EXCLUDED.uploaded_by`,
    [kind.data, parsed.data.state, parsed.data.filename, buffer, req.user.sub]
  );
  await logAction({ actorUserId: req.user.sub, action: 'brochure_pdf_uploaded', targetType: 'content_document', targetId: `${kind.data}:${parsed.data.state}`, metadata: { filename: parsed.data.filename, state: parsed.data.state } });
  res.json({ ok: true });
}));

router.delete('/content/brochure/:kind', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const kind = brochureKindSchema.safeParse(req.params.kind);
  if (!kind.success) return res.status(400).json({ error: 'Invalid brochure kind' });
  const state = (req.query.state || 'ALL').toUpperCase();

  await query('DELETE FROM content_documents WHERE kind = $1 AND state = $2', [kind.data, state]);
  await logAction({ actorUserId: req.user.sub, action: 'brochure_pdf_removed', targetType: 'content_document', targetId: `${kind.data}:${state}` });
  res.json({ ok: true });
}));

// --- Client resources (supporting documents & grief resources) ---

router.get('/content/resources', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, title, description, filename, url, state, sort_order, is_active, created_at
     FROM client_resources ORDER BY sort_order, created_at`
  );
  res.json({ resources: rows });
}));

const resourceSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().max(2000).optional().nullable(),
  url: z.string().url().optional().nullable(),
  dataBase64: z.string().optional().nullable(),
  filename: z.string().optional().nullable(),
  state: z.enum(['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']).optional().nullable(),
  sortOrder: z.number().int().optional().default(0),
});

router.post('/content/resources', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = resourceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid resource', details: parsed.error.flatten() });
  const d = parsed.data;

  if (!d.url && !d.dataBase64) {
    return res.status(400).json({ error: 'Provide either a PDF file or a link.' });
  }

  let buffer = null;
  if (d.dataBase64) {
    const decoded = decodePdf(d.dataBase64);
    if (decoded.error) return res.status(400).json({ error: decoded.error });
    buffer = decoded.buffer;
  }

  const { rows } = await query(
    `INSERT INTO client_resources (title, description, filename, mime_type, data, url, state, sort_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [d.title, d.description || null, d.filename || null, buffer ? 'application/pdf' : null, buffer, d.url || null, d.state || null, d.sortOrder || 0, req.user.sub]
  );
  await logAction({ actorUserId: req.user.sub, action: 'client_resource_added', targetType: 'client_resource', targetId: rows[0].id, metadata: { title: d.title } });
  res.status(201).json({ id: rows[0].id });
}));

router.delete('/content/resources/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await query('DELETE FROM client_resources WHERE id = $1', [req.params.id]);
  await logAction({ actorUserId: req.user.sub, action: 'client_resource_removed', targetType: 'client_resource', targetId: req.params.id });
  res.json({ ok: true });
}));

export default router;
