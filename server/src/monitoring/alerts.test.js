import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { alertServerError, _resetAlertState, _setSender } from './alerts.js';

/**
 * The cooldown is the part that matters.
 *
 * Alerting that fires on every request gets the channel muted within an
 * hour, which leaves you worse off than no alerting at all — you now
 * believe you have monitoring and don't. These assert the suppression
 * actually suppresses, and that it doesn't suppress the wrong things.
 *
 * The sender is injected, so these assert the DECISION to alert rather
 * than an incidental side effect like a log line.
 */

let sent;

beforeEach(() => {
  _resetAlertState();
  sent = [];
  _setSender(async (msg) => { sent.push(msg); });
});

test('client errors never alert', () => {
  // 4xx is ordinary traffic — bad input, wrong state. Alerting on it
  // would bury the faults that matter.
  for (const status of [400, 401, 403, 404, 409, 422]) {
    alertServerError(new Error('bad input'), { method: 'POST', url: '/x', status });
  }
  assert.equal(sent.length, 0);
});

test('the same fault alerts once, then is suppressed', () => {
  const err = new TypeError('cannot read x of undefined');
  const ctx = { method: 'POST', url: '/api/jobs/:id/charge', status: 500 };

  alertServerError(err, ctx);
  assert.equal(sent.length, 1, 'first occurrence alerts');

  for (let i = 0; i < 50; i++) alertServerError(err, ctx);
  assert.equal(sent.length, 1, '50 repeats must not send 50 alerts');
});

test('different routes are tracked separately', () => {
  const err = new TypeError('boom');
  alertServerError(err, { method: 'POST', url: '/api/jobs/a/charge', status: 500 });
  alertServerError(err, { method: 'POST', url: '/api/jobs/a/refund', status: 500 });
  assert.equal(sent.length, 2, 'a second broken route must still be reported');
});

test('different error types on one route are tracked separately', () => {
  const ctx = { method: 'GET', url: '/api/jobs', status: 500 };
  alertServerError(new TypeError('a'), ctx);
  alertServerError(new RangeError('b'), ctx);
  assert.equal(sent.length, 2, 'a new KIND of failure is new information');
});

test('the fingerprint ignores the message, not just the name', () => {
  // Messages routinely embed ids ("job 4f2a... not found"). Including
  // them would make every occurrence look new and defeat the cooldown
  // entirely — the exact failure this design exists to avoid.
  const ctx = { method: 'GET', url: '/api/jobs/:id', status: 500 };
  alertServerError(new Error('job 111 failed'), ctx);
  alertServerError(new Error('job 222 failed'), ctx);
  alertServerError(new Error('job 333 failed'), ctx);
  assert.equal(sent.length, 1, 'same fault, different ids — one alert');
});

test('a missing status is treated as a server error', () => {
  // An error thrown without a status is an unknown fault, which is more
  // likely serious than not. Defaulting to "ignore" would hide exactly
  // the errors nobody anticipated.
  alertServerError(new Error('unknown'), { method: 'GET', url: '/api/x' });
  assert.equal(sent.length, 1);
});
