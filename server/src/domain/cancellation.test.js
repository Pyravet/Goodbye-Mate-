import test from 'node:test';
import assert from 'node:assert/strict';
import { cancellationFee, hoursUntilAppointment } from './cancellation.js';

const TIERS = [
  { hoursBefore: 24, percent: 0, label: 'More than 24 hours notice' },
  { hoursBefore: 4, percent: 50, label: '4 to 24 hours notice' },
  { hoursBefore: 0, percent: 100, label: 'Less than 4 hours notice' },
];
const ON = { cancellationPolicyEnabled: true, cancellationTiers: TIERS };

test('policy off means no fee, whatever the notice', () => {
  const r = cancellationFee({ billTotal: 498, hoursNotice: 0.5, pricing: { cancellationTiers: TIERS } });
  assert.equal(r.applies, false);
  assert.equal(r.fee, 0);
});

test('plenty of notice is free', () => {
  const r = cancellationFee({ billTotal: 498, hoursNotice: 72, pricing: ON });
  assert.equal(r.fee, 0);
  assert.equal(r.applies, false);
});

test('mid tier charges its percentage', () => {
  const r = cancellationFee({ billTotal: 498, hoursNotice: 10, pricing: ON });
  assert.equal(r.percent, 50);
  assert.equal(r.fee, 249);
  assert.equal(r.applies, true);
});

test('short notice charges the full amount', () => {
  const r = cancellationFee({ billTotal: 498, hoursNotice: 1, pricing: ON });
  assert.equal(r.percent, 100);
  assert.equal(r.fee, 498);
});

test('tier boundaries are inclusive at the threshold', () => {
  // Exactly 24h should get the FREE tier, not the 50% one — a client
  // cancelling precisely on the stated deadline should not be penalised
  // by a rounding decision.
  assert.equal(cancellationFee({ billTotal: 100, hoursNotice: 24, pricing: ON }).percent, 0);
  assert.equal(cancellationFee({ billTotal: 100, hoursNotice: 23.99, pricing: ON }).percent, 50);
  assert.equal(cancellationFee({ billTotal: 100, hoursNotice: 4, pricing: ON }).percent, 50);
  assert.equal(cancellationFee({ billTotal: 100, hoursNotice: 3.99, pricing: ON }).percent, 100);
});

test('cancelling AFTER the appointment charges the highest tier', () => {
  // A no-show has cost the whole slot; falling through to "no fee"
  // because the number went negative would be backwards.
  const r = cancellationFee({ billTotal: 498, hoursNotice: -3, pricing: ON });
  assert.equal(r.percent, 100);
  assert.equal(r.fee, 498);
});

test('tiers stored out of order still behave correctly', () => {
  // Admin edits these by hand; a mis-ordered list must not silently
  // produce the wrong fee.
  const shuffled = {
    cancellationPolicyEnabled: true,
    cancellationTiers: [
      { hoursBefore: 0, percent: 100 },
      { hoursBefore: 24, percent: 0 },
      { hoursBefore: 4, percent: 50 },
    ],
  };
  assert.equal(cancellationFee({ billTotal: 100, hoursNotice: 48, pricing: shuffled }).percent, 0);
  assert.equal(cancellationFee({ billTotal: 100, hoursNotice: 10, pricing: shuffled }).percent, 50);
  assert.equal(cancellationFee({ billTotal: 100, hoursNotice: 1, pricing: shuffled }).percent, 100);
});

test('no tiers configured means no fee rather than a crash', () => {
  const r = cancellationFee({
    billTotal: 498, hoursNotice: 1,
    pricing: { cancellationPolicyEnabled: true, cancellationTiers: [] },
  });
  assert.equal(r.applies, false);
  assert.match(r.reason, /no cancellation tiers/i);
});

test('fees round to whole cents', () => {
  const r = cancellationFee({ billTotal: 449.99, hoursNotice: 10, pricing: ON });
  assert.equal(r.fee, 225, '449.99 * 50% = 224.995, rounds to 225.00');
  assert.equal(Math.round(r.fee * 100), r.fee * 100, 'never a fraction of a cent');
});

test('hoursUntilAppointment handles both date shapes', () => {
  const now = new Date('2026-09-15T09:00:00');
  assert.equal(hoursUntilAppointment('2026-09-15', '13:00', now), 4);
  assert.equal(hoursUntilAppointment('2026-09-15', '13:00:00', now), 4);
  assert.equal(hoursUntilAppointment(new Date('2026-09-15T00:00:00Z'), '13:00', now), 4);
  // Already passed.
  assert.ok(hoursUntilAppointment('2026-09-15', '08:00', now) < 0);
});
