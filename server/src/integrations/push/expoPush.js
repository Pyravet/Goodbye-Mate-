import { query } from '../../db/pool.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Sends a push via Expo's push service to every device the user has
// registered. Expo internally routes to APNs (iOS) or FCM (Android) —
// we never talk to Apple/Google directly.
export async function sendExpoPushToUser(userId, payload) {
  const { rows } = await query('SELECT id, token FROM expo_push_tokens WHERE user_id = $1', [userId]);
  if (rows.length === 0) return;

  const messages = rows.map((r) => ({
    to: r.token,
    title: payload.title,
    body: payload.body,
    data: { url: payload.url },
    sound: 'default',
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    const data = await res.json().catch(() => null);

    // Expo returns per-message tickets; a DeviceNotRegistered error means
    // the token is dead (app uninstalled, etc.) — clean it up.
    if (Array.isArray(data?.data)) {
      for (let i = 0; i < data.data.length; i++) {
        const ticket = data.data[i];
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          await query('DELETE FROM expo_push_tokens WHERE token = $1', [rows[i].token]);
        }
      }
    }
  } catch (err) {
    console.error('Expo push send failed:', err.message);
  }
}
