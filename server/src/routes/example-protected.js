import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Any logged-in user (admin or vet).
router.get('/whoami', requireAuth, (req, res) => {
  res.json({ sub: req.user.sub, role: req.user.role, email: req.user.email });
});

// Admin-only example — Phase 2's job/pricing/vet-management routes will
// follow this same requireAuth + requireRole('admin') pattern.
router.get('/admin-only', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ message: 'You are an admin.' });
});

export default router;
