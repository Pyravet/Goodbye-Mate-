import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

/**
 * GET /notifications — recent notifications plus the unread count.
 *
 * Capped at 30: the bell is a "what have I missed" glance, not an
 * archive, and an unbounded list would grow without limit for a busy
 * admin. Older ones simply age out of view.
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, title, body, url, category, read_at, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 30`,
    [req.user.sub]
  );

  const { rows: countRows } = await query(
    'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [req.user.sub]
  );

  res.json({ notifications: rows, unread: countRows[0].count });
}));

/**
 * Just the count — polled frequently by the bell badge, so it stays a
 * single indexed COUNT rather than fetching rows the caller discards.
 */
router.get('/unread-count', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [req.user.sub]
  );
  res.json({ unread: rows[0].count });
}));

/** Mark one notification read — used when it's tapped. */
router.post('/:id/read', requireAuth, asyncHandler(async (req, res) => {
  // user_id in the WHERE clause doubles as the authorisation check:
  // you can only ever mark your own notifications read.
  const { rows } = await query(
    `UPDATE notifications SET read_at = now()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL
     RETURNING id`,
    [req.params.id, req.user.sub]
  );
  // Already-read is a no-op rather than an error: double-taps and
  // retries shouldn't surface a failure to the user.
  res.json({ ok: true, updated: rows.length });
}));

/** Mark everything read. */
router.post('/read-all', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL RETURNING id',
    [req.user.sub]
  );
  res.json({ ok: true, updated: rows.length });
}));

/** Remove a notification from the bell entirely. */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  await query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [req.params.id, req.user.sub]);
  res.json({ ok: true });
}));

export default router;
