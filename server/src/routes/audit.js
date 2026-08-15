import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Everything in the app already calls logAction() on every meaningful
// change — this is the first time any of that is actually surfaced to
// an admin instead of just sitting in the table.
router.get('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const { rows } = await query(
    `SELECT al.*, u.full_name AS actor_name, u.email AS actor_email
     FROM audit_log al
     LEFT JOIN users u ON u.id = al.actor_user_id
     ORDER BY al.created_at DESC
     LIMIT $1`,
    [limit]
  );
  res.json({ entries: rows });
}));

export default router;
