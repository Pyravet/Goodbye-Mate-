// Admin management of extra content on the client journey page.
// job_id NULL = global (every client); job_id set = that one job only.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logAction } from '../audit/log.js';
import { parseVideoUrl, validateAttachment, MAX_FILES_PER_BLOCK } from '../domain/journeyBlocks.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const blockSchema = z.object({
  jobId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(5000).optional().nullable(),
  videoUrl: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

function checkVideo(videoUrl) {
  if (videoUrl && !parseVideoUrl(videoUrl)) {
    return 'Video must be an https YouTube or Vimeo link, or a direct .mp4/.webm link.';
  }
  return null;
}

async function blocksWithFiles(whereSql, params) {
  const { rows: blocks } = await query(
    `SELECT id, job_id, title, body, video_url, sort_order, is_active, created_at
     FROM journey_blocks WHERE ${whereSql} ORDER BY sort_order, created_at`, params);
  if (!blocks.length) return [];
  const { rows: files } = await query(
    `SELECT id, block_id, filename, mime_type, size_bytes FROM journey_block_files
     WHERE block_id = ANY($1::uuid[]) ORDER BY created_at`, [blocks.map((b) => b.id)]);
  return blocks.map((b) => ({ ...b, files: files.filter((f) => f.block_id === b.id) }));
}

// ?jobId=<uuid> for one job's fields; omit for the global ones.
router.get('/', asyncHandler(async (req, res) => {
  if (req.query.jobId) {
    if (!z.string().uuid().safeParse(req.query.jobId).success) return res.status(400).json({ error: 'Invalid job id' });
    return res.json({ blocks: await blocksWithFiles('job_id = $1', [req.query.jobId]) });
  }
  res.json({ blocks: await blocksWithFiles('job_id IS NULL', []) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const parsed = blockSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid field', details: parsed.error.flatten() });
  const d = parsed.data;
  const vErr = checkVideo(d.videoUrl);
  if (vErr) return res.status(400).json({ error: vErr });
  if (d.jobId) {
    const { rows } = await query('SELECT 1 FROM jobs WHERE id = $1', [d.jobId]);
    if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  }
  const { rows } = await query(
    `INSERT INTO journey_blocks (job_id, title, body, video_url, sort_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [d.jobId || null, d.title, d.body || null, d.videoUrl || null, d.sortOrder ?? 0, req.user.sub]);
  await logAction({ actorUserId: req.user.sub, action: 'journey_block_added', targetType: 'journey_block', targetId: rows[0].id, metadata: { title: d.title, jobId: d.jobId || null } });
  res.status(201).json({ id: rows[0].id });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const parsed = blockSchema.omit({ jobId: true }).partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid field', details: parsed.error.flatten() });
  const d = parsed.data;
  const vErr = checkVideo(d.videoUrl);
  if (vErr) return res.status(400).json({ error: vErr });
  const { rows } = await query(
    `UPDATE journey_blocks SET
       title = COALESCE($2, title),
       body = CASE WHEN $3::boolean THEN $4 ELSE body END,
       video_url = CASE WHEN $5::boolean THEN $6 ELSE video_url END,
       sort_order = COALESCE($7, sort_order),
       is_active = COALESCE($8, is_active),
       updated_at = now()
     WHERE id = $1 RETURNING id`,
    [req.params.id, d.title ?? null,
     'body' in d, d.body || null,
     'videoUrl' in d, d.videoUrl || null,
     d.sortOrder ?? null, d.isActive ?? null]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  await logAction({ actorUserId: req.user.sub, action: 'journey_block_updated', targetType: 'journey_block', targetId: req.params.id });
  res.json({ ok: true });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await query('DELETE FROM journey_blocks WHERE id = $1', [req.params.id]);
  await logAction({ actorUserId: req.user.sub, action: 'journey_block_removed', targetType: 'journey_block', targetId: req.params.id });
  res.json({ ok: true });
}));

router.post('/:id/files', asyncHandler(async (req, res) => {
  const body = z.object({ filename: z.string().trim().min(1).max(200), dataBase64: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid upload' });
  const { rows: blk } = await query('SELECT 1 FROM journey_blocks WHERE id = $1', [req.params.id]);
  if (!blk[0]) return res.status(404).json({ error: 'Not found' });
  const { rows: cnt } = await query('SELECT count(*)::int AS n FROM journey_block_files WHERE block_id = $1', [req.params.id]);
  if (cnt[0].n >= MAX_FILES_PER_BLOCK) return res.status(400).json({ error: `At most ${MAX_FILES_PER_BLOCK} files per field` });
  const v = validateAttachment(body.data.dataBase64);
  if (v.error) return res.status(400).json({ error: v.error });
  const safeName = body.data.filename.replace(/[\r\n"]/g, '');
  const { rows } = await query(
    `INSERT INTO journey_block_files (block_id, filename, mime_type, size_bytes, data)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.params.id, safeName, v.mimeType, v.buffer.length, v.buffer]);
  await logAction({ actorUserId: req.user.sub, action: 'journey_file_added', targetType: 'journey_block', targetId: req.params.id, metadata: { filename: safeName } });
  res.status(201).json({ id: rows[0].id });
}));

router.delete('/files/:fileId', asyncHandler(async (req, res) => {
  await query('DELETE FROM journey_block_files WHERE id = $1', [req.params.fileId]);
  await logAction({ actorUserId: req.user.sub, action: 'journey_file_removed', targetType: 'journey_block_file', targetId: req.params.fileId });
  res.json({ ok: true });
}));

export default router;
