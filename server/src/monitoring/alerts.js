import { sendSlackMessage } from '../integrations/slack/webhook.js';

/**
 * Operational alerting.
 *
 * Server errors were logged and nothing else, so the first anyone knew
 * about a failure was a client ringing to say the payment page was
 * broken. Railway logs are only read when someone already suspects a
 * problem, which is exactly the wrong time to find out.
 *
 * Deliberately NOT a monitoring platform. This is the smallest thing
 * that turns "silent failure" into "someone knows": a Slack message on
 * the first occurrence of each distinct fault.
 */

// The sender, injectable for tests. Production uses Slack; a test can
// substitute a recorder and assert on the DECISION to alert rather than
// on an incidental side effect.
let sender = sendSlackMessage;

/** Test seam. Pass nothing to restore the real sender. */
export function _setSender(fn) {
  sender = fn || sendSlackMessage;
}

// Fingerprint -> last alerted timestamp.
const lastAlerted = new Map();

// One alert per distinct fault per 15 minutes. A route that 500s on
// every request would otherwise send hundreds of identical messages and
// the channel would be muted within the hour — which leaves you worse
// off than no alerting at all.
const COOLDOWN_MS = 15 * 60 * 1000;

// The map would grow without bound on a server that throws many
// distinct errors, so old entries are dropped.
const MAX_TRACKED = 500;

/**
 * A stable identity for "the same problem happening again".
 *
 * Method + route + error name, NOT the message: messages often embed
 * ids or values, so using them would treat every occurrence as new and
 * defeat the cooldown entirely.
 */
function fingerprint(method, routePath, err) {
  return `${method} ${routePath} ${err?.name || 'Error'}`;
}

function shouldAlert(key) {
  const now = Date.now();
  const last = lastAlerted.get(key);
  if (last && now - last < COOLDOWN_MS) return false;

  if (lastAlerted.size >= MAX_TRACKED) {
    // Drop the oldest half rather than clearing entirely, so an ongoing
    // incident doesn't suddenly start re-alerting on every request.
    const sorted = [...lastAlerted.entries()].sort((a, b) => a[1] - b[1]);
    for (const [k] of sorted.slice(0, Math.floor(MAX_TRACKED / 2))) lastAlerted.delete(k);
  }

  lastAlerted.set(key, now);
  return true;
}

/**
 * Alert on a server-side fault.
 *
 * @param {Error} err
 * @param {object} context { method, url, status, userId }
 */
export function alertServerError(err, { method, url, status, userId } = {}) {
  // Client errors are ordinary traffic — bad input, wrong state — and
  // alerting on them would bury the ones that matter.
  if (status && status < 500) return;

  const key = fingerprint(method, url, err);
  if (!shouldAlert(key)) return;

  // Fire-and-forget. Alerting must never be able to fail a request, and
  // an error thrown from inside the error handler is genuinely nasty to
  // debug.
  sender(
    `🚨 *Server error* — \`${method} ${url}\`\n`
    + `${err?.name || 'Error'}: ${String(err?.message || '').slice(0, 300)}\n`
    + `${userId ? `user: ${userId}\n` : ''}`
    + `_Further alerts for this fault are suppressed for 15 minutes._`
  ).catch((e) => console.error('Error alert failed to send:', e.message));
}

/**
 * Alert on a crash-level fault — an unhandled rejection or uncaught
 * exception. These indicate the process is in an unknown state, so they
 * are never suppressed.
 */
export function alertCrash(kind, err) {
  sender(
    `🔥 *${kind}* — the API process hit an unhandled fault.\n`
    + `${err?.name || 'Error'}: ${String(err?.message || err).slice(0, 300)}`
  ).catch((e) => console.error('Crash alert failed to send:', e.message));
}

/** Test seam — lets a test assert the cooldown without waiting 15 minutes. */
export function _resetAlertState() {
  lastAlerted.clear();
}
