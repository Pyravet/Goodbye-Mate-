import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyWhen, trySms, tryEmail } from './jobNotices.js';

test('friendlyWhen formats date and 12-hour time', () => {
  assert.equal(friendlyWhen('2026-10-16', '14:30'), 'Fri 16 Oct at 2:30pm');
  assert.equal(friendlyWhen('2026-10-16', '00:05'), 'Fri 16 Oct at 12:05am');
  assert.equal(friendlyWhen('2026-10-16', '12:00'), 'Fri 16 Oct at 12:00pm');
});
test('friendlyWhen tolerates a full timestamp date', () => {
  assert.equal(friendlyWhen('2026-10-16T00:00:00.000Z', '09:00'), 'Fri 16 Oct at 9:00am');
});
test('channels with no address or no configuration report why, never throw', async () => {
  const saved = { ...process.env };
  delete process.env.MSG91_AUTH_KEY; delete process.env.EMAIL_SMTP_HOST;
  assert.equal(await trySms(null, 'x'), 'no-phone');
  assert.equal(await trySms('0400000000', 'x'), 'not-configured');
  assert.equal(await tryEmail(null, 's', 't'), 'no-email');
  assert.equal(await tryEmail('a@b.com', 's', 't'), 'not-configured');
  Object.assign(process.env, saved);
});
