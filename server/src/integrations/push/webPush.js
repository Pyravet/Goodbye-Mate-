import webpush from 'web-push';
import { query } from '../../db/pool.js';

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const contactEmail = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@goodbyemate.com.au';

let configured = false;
if (publicKey && privateKey) {
  webpush.setVapidDetails(contactEmail, publicKey, privateKey);
  configured = true;
} else {
  console.warn('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications are disabled. Generate a pair with: npx web-push generate-vapid-keys');
}

// Sends a push to every device the given user has subscribed on. Silently
// drops dead subscriptions (410 Gone) rather than erroring the caller —
// a stale subscription shouldn't block, say, a job-offer flow.
export async function sendPushToUser(userId, payload) {
  if (!configured) return;

  const { rows } = await query('SELECT id, subscription FROM push_subscriptions WHERE user_id = $1', [userId]);

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
        } else {
          console.error('Push send failed:', err.message);
        }
      }
    })
  );
}

export function isPushConfigured() {
  return configured;
}
