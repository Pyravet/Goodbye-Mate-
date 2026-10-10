// One place for "tell the client / tell the vet" messages about a job —
// SMS (MSG91) AND email — so a cancellation, reschedule, refund or bill
// change reaches people the same way everywhere.
//
// Every send is isolated: a channel that isn't configured, has no
// address, fails or hangs is reported in the returned status and never
// throws, so one dead channel can't fail the admin's action or stop the
// other channel going out.
import { query } from '../db/pool.js';
import { notifyUser } from './notify.js';
import { isMsg91Configured, sendTemplatedSms } from '../integrations/sms/msg91.js';
import { isTemplateConfigured } from '../integrations/sms/templates.js';
import { sendEmail, isEmailConfigured } from '../integrations/email/smtp.js';

const SEND_TIMEOUT_MS = 8000;

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), SEND_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** 'sent' | 'no-phone' | 'not-configured' | 'failed' */
export async function trySms(phone, message) {
  if (!phone) return 'no-phone';
  if (!isMsg91Configured() || !isTemplateConfigured('genericMessage')) return 'not-configured';
  try {
    await withTimeout(sendTemplatedSms(phone, 'genericMessage', { message }));
    return 'sent';
  } catch (e) {
    console.error('notice sms failed:', e.message);
    return 'failed';
  }
}

/** 'sent' | 'no-email' | 'not-configured' | 'failed' */
export async function tryEmail(to, subject, text) {
  if (!to) return 'no-email';
  if (!isEmailConfigured()) return 'not-configured';
  try {
    await withTimeout(sendEmail({ to, subject, text }));
    return 'sent';
  } catch (e) {
    console.error('notice email failed:', e.message);
    return 'failed';
  }
}

async function signOff() {
  try {
    const { rows } = await query("SELECT config->'company' AS company FROM content_settings WHERE id = true");
    const c = rows[0]?.company || {};
    return [c.name || 'Goodbye Mate', c.phone, c.email].filter(Boolean).join('\n');
  } catch {
    return 'Goodbye Mate';
  }
}

/** "Fri 16 Oct at 2:30pm" from 'YYYY-MM-DD' + 'HH:MM'. Pure. */
export function friendlyWhen(dateStr, timeStr) {
  const [y, m, d] = String(dateStr || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return `${dateStr} at ${timeStr}`;
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
  const [hh, mm] = String(timeStr || '00:00').split(':').map(Number);
  const suffix = hh >= 12 ? 'pm' : 'am';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${day} at ${h12}:${String(mm || 0).padStart(2, '0')}${suffix}`;
}

/**
 * Tell the CLIENT by SMS and email.
 * @returns {{sms: string, email: string}}
 */
export async function noticeClient(job, { message, subject }) {
  const [sms, email] = await Promise.all([
    trySms(job.client_phone, `Hi ${job.client_name}, ${message}`),
    (async () => {
      if (!job.client_email) return 'no-email';
      const footer = await signOff();
      return tryEmail(job.client_email, subject, `Hi ${job.client_name},\n\n${message}\n\n${footer}`);
    })(),
  ]);
  return { sms, email };
}

/**
 * Tell the ASSIGNED VET: in-app bell + push, SMS and email.
 * `category` should be 'cancellation' or 'reschedule' for changes a vet
 * who has committed to the job must hear about even while paused.
 * @returns {{push: string, sms: string, email: string}}
 */
export async function noticeVet(vetId, job, { title, message, subject, category }) {
  if (!vetId) return { push: 'no-vet', sms: 'no-vet', email: 'no-vet' };
  const { rows } = await query(
    'SELECT u.id AS user_id, u.full_name, u.phone, u.email FROM vets v JOIN users u ON u.id = v.user_id WHERE v.id = $1',
    [vetId]
  );
  const vet = rows[0];
  if (!vet) return { push: 'no-vet', sms: 'no-vet', email: 'no-vet' };

  let push = 'sent';
  try {
    await notifyUser(vet.user_id, { title, body: message, url: `/jobs/${job.id}`, category });
  } catch (e) {
    console.error('vet notice push failed:', e.message);
    push = 'failed';
  }
  const [sms, email] = await Promise.all([
    trySms(vet.phone, `Hi ${vet.full_name}, ${message}`),
    (async () => {
      const footer = await signOff();
      return tryEmail(vet.email, subject, `Hi ${vet.full_name},\n\n${message}\n\n${footer}`);
    })(),
  ]);
  return { push, sms, email };
}
