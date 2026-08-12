import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAction } from '../audit/log.js';

const router = Router();

router.get('/pricing', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  res.json({ pricing: rows[0].config });
});

router.put('/pricing', requireAuth, requireRole('admin'), async (req, res) => {
  const config = req.body;
  if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Invalid pricing config' });

  await query(
    'UPDATE pricing_settings SET config = $1, updated_at = now(), updated_by = $2 WHERE id = true',
    [JSON.stringify(config), req.user.sub]
  );
  await logAction({ actorUserId: req.user.sub, action: 'pricing_updated', targetType: 'settings' });
  res.json({ ok: true });
});

router.get('/content', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT config FROM content_settings WHERE id = true');
  res.json({ content: rows[0].config });
});

router.put('/content', requireAuth, requireRole('admin'), async (req, res) => {
  const config = req.body;
  if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Invalid content config' });

  await query(
    'UPDATE content_settings SET config = $1, updated_at = now(), updated_by = $2 WHERE id = true',
    [JSON.stringify(config), req.user.sub]
  );
  await logAction({ actorUserId: req.user.sub, action: 'content_updated', targetType: 'settings' });
  res.json({ ok: true });
});

router.get('/templates', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT id, label, text FROM message_templates ORDER BY id');
  res.json({ templates: rows });
});

const templateSchema = z.object({ label: z.string().min(1), text: z.string().min(1) });

router.put('/templates/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid template', details: parsed.error.flatten() });

  const { rows } = await query(
    `UPDATE message_templates SET label = $1, text = $2, updated_at = now() WHERE id = $3 RETURNING id`,
    [parsed.data.label, parsed.data.text, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Template not found' });

  await logAction({ actorUserId: req.user.sub, action: 'template_updated', targetType: 'message_template', targetId: req.params.id });
  res.json({ ok: true });
});

export default router;
