import { query } from '../db/pool.js';
import { sendPushToUser } from '../integrations/push/webPush.js';
import { sendExpoPushToUser } from '../integrations/push/expoPush.js';

/**
 * Notify a user: record it for the in-app bell AND send a push.
 *
 * Previously every call site sent a push directly. That made
 * notifications purely ephemeral — if the phone was off, permission was
 * never granted, or the person swiped it away, it was gone with no
 * record anywhere. Routing everything through here means the bell is
 * always populated even when push fails or was never enabled, which is
 * the common case for admin on a desktop browser.
 *
 * The database write is awaited (it's the durable part); pushes are
 * fire-and-forget, since a push provider failing must not fail the
 * action that triggered it — a vet's job assignment shouldn't roll back
 * because a stale push subscription 410'd.
 *
 * @param {string} userId
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {string} [opts.url]      in-app path, e.g. '/jobs/<id>'
 * @param {string} [opts.category] 'message' | 'job' | 'payout' | ...
 * @param {boolean} [opts.push=true] set false for low-value notices that
 *   belong in the bell but shouldn't buzz someone's phone.
 */
export async function notifyUser(userId, { title, body, url, category, push = true }) {
  if (!userId) return;

  await query(
    `INSERT INTO notifications (user_id, title, body, url, category)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, title, body || null, url || null, category || null]
  );

  if (!push) return;

  sendPushToUser(userId, { title, body, url })
    .catch((err) => console.error('web push failed:', err.message));
  sendExpoPushToUser(userId, { title, body, url })
    .catch((err) => console.error('expo push failed:', err.message));
}

/**
 * Notify every active admin.
 *
 * Each admin gets their OWN notification row rather than one shared
 * row, so read state is per-person — one admin reading something
 * shouldn't clear the bell for everyone else.
 *
 * @param {object} opts same shape as notifyUser
 * @param {string} [opts.exceptUserId] skip the person who triggered it,
 *   so nobody is notified of their own action.
 */
export async function notifyAdmins({ title, body, url, category, exceptUserId, push = true }) {
  const { rows } = await query(
    `SELECT id FROM users WHERE role = 'admin' AND is_active = true AND ($1::uuid IS NULL OR id <> $1)`,
    [exceptUserId || null]
  );
  await Promise.all(
    rows.map((r) => notifyUser(r.id, { title, body, url, category, push }))
  );
}
