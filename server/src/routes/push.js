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

/**
 * GET /push/preferences — the caller's own pause and quiet hours.
 */
router.get('/preferences', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT notifications_paused_until, quiet_hours_start, quiet_hours_end
     FROM users WHERE id = $1`,
    [req.user.sub]
  );
  res.json(rows[0] || {});
}));

/**
 * PUT /push/preferences — pause notifications, or set quiet hours.
 *
 * Replaces reaching for /unsubscribe, which DELETED the subscription:
 * a vet who wanted quiet overnight would have had to re-register the
 * device, and if they forgot they'd stop receiving offers permanently
 * without realising.
 *
 * Always scoped to req.user.sub — there is no route to change someone
 * else's notification settings, deliberately.
 */
router.put('/preferences', requireAuth, asyncHandler(async (req, res) => {
  const { pauseMinutes, quietHoursStart, quietHoursEnd } = req.body || {};

  let pausedUntil;
  if (pauseMinutes === null || pauseMinutes === 0) {
    pausedUntil = null; // resume now
  } else if (pauseMinutes !== undefined) {
    const mins = Number(pauseMinutes);
    // Capped at a week. An indefinite pause is how a vet goes quiet for
    // a month and blames the app for having no work.
    if (!Number.isFinite(mins) || mins < 0 || mins > 7 * 24 * 60) {
      return res.status(400).json({ error: 'Choose a pause of up to 7 days.' });
    }
    pausedUntil = new Date(Date.now() + mins * 60_000);
  }

  for (const [label, v] of [['start', quietHoursStart], ['end', quietHoursEnd]]) {
    if (v !== undefined && v !== null && !(Number.isInteger(Number(v)) && v >= 0 && v <= 23)) {
      return res.status(400).json({ error: `Quiet hours ${label} must be an hour from 0 to 23.` });
    }
  }

  const { rows } = await query(
    `UPDATE users SET
       notifications_paused_until = CASE WHEN $1::boolean THEN $2 ELSE notifications_paused_until END,
       quiet_hours_start = CASE WHEN $3::boolean THEN $4 ELSE quiet_hours_start END,
       quiet_hours_end   = CASE WHEN $5::boolean THEN $6 ELSE quiet_hours_end END
     WHERE id = $7
     RETURNING notifications_paused_until, quiet_hours_start, quiet_hours_end`,
    [
      pausedUntil !== undefined, pausedUntil ?? null,
      quietHoursStart !== undefined, quietHoursStart ?? null,
      quietHoursEnd !== undefined, quietHoursEnd ?? null,
      req.user.sub,
    ]
  );
  res.json(rows[0]);
}));
