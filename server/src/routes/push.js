import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { isPushConfigured } from '../integrations/push/webPush.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/config', requireAuth, (req, res) => {
  res.json({ configured: isPushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

router.post('/subscribe', requireAuth, asyncHandler(async (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });

  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, subscription)
     VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET subscription = EXCLUDED.subscription, user_id = EXCLUDED.user_id`,
    [req.user.sub, subscription.endpoint, JSON.stringify(subscription)]
  );

  res.status(201).json({ ok: true });
}));

router.post('/unsubscribe', requireAuth, asyncHandler(async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.sub]);
  res.status(204).end();
}));

// Native app (Expo) push token registration — separate from the web
// push subscription above, since it's a different delivery mechanism.
router.post('/register-expo-token', requireAuth, asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });

  await query(
    `INSERT INTO expo_push_tokens (user_id, token) VALUES ($1, $2)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id`,
    [req.user.sub, token]
  );

  res.status(201).json({ ok: true });
}));

export default router;
