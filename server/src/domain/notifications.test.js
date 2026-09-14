import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldDeliverPush, inQuietHours, estimateEtaMinutes } from './notifications.js';

const at = (h) => new Date(`2026-09-15T${String(h).padStart(2, '0')}:00:00+10:00`);

test('quiet hours crossing midnight work', () => {
  // 22:00 to 07:00 is the normal case. A window that only worked inside
  // one calendar day would be useless for exactly the hours people want
  // protected.
  for (const h of [22, 23, 0, 3, 6]) {
    assert.equal(inQuietHours(22, 7, at(h)), true, `${h}:00 should be quiet`);
  }
  for (const h of [7, 12, 21]) {
    assert.equal(inQuietHours(22, 7, at(h)), false, `${h}:00 should not be quiet`);
  }
});

test('a same-hour window means quiet hours are off', () => {
  // Otherwise 0→0 would read as "quiet all day" and silence everything.
  assert.equal(inQuietHours(0, 0, at(3)), false);
});

test('unset quiet hours never suppress', () => {
  assert.equal(inQuietHours(null, null, at(3)), false);
  assert.equal(inQuietHours(undefined, 7, at(3)), false);
});

test('a pause suppresses offers but expires by itself', () => {
  const future = new Date(Date.now() + 60 * 60_000).toISOString();
  const past = new Date(Date.now() - 60 * 60_000).toISOString();

  assert.equal(shouldDeliverPush({ notifications_paused_until: future }, 'offer').deliver, false);
  // An EXPIRED pause must not keep someone silenced — no cleanup job
  // exists, so a stale row has to be harmless.
  assert.equal(shouldDeliverPush({ notifications_paused_until: past }, 'offer').deliver, true);
  assert.equal(shouldDeliverPush({}, 'offer').deliver, true);
});

test('reminders, cancellations and reassignments ALWAYS get through', () => {
  // The failure that matters most. A vet who accepted a job has made a
  // commitment; a reminder for a visit they are about to miss, or a job
  // cancelled out from under them, must arrive regardless. Turning up
  // to a cancelled euthanasia is worse than being woken.
  const paused = {
    notifications_paused_until: new Date(Date.now() + 3600_000).toISOString(),
    quiet_hours_start: 0,
    quiet_hours_end: 23,
  };
  for (const c of ['reminder', 'cancellation', 'reassignment']) {
    assert.equal(shouldDeliverPush(paused, c).deliver, true, c);
  }
  // An offer is an invitation — silence is a legitimate answer at 3am.
  assert.equal(shouldDeliverPush(paused, 'offer').deliver, false);
});

test('the pause reason is reported, so it can be explained', () => {
  const paused = { notifications_paused_until: new Date(Date.now() + 3600_000).toISOString() };
  assert.equal(shouldDeliverPush(paused, 'offer').reason, 'paused');
  assert.equal(shouldDeliverPush({ quiet_hours_start: 0, quiet_hours_end: 23 }, 'offer').reason, 'quiet-hours');
});

// --- ETA estimate ---

test('a nearby suburb gives a plausible ETA', () => {
  // Newcastle CBD to Tighes Hill, about 4km by road.
  const eta = estimateEtaMinutes({
    fromLat: -32.9283, fromLng: 151.7817, toLat: -32.9089, toLng: 151.7569,
  });
  assert.ok(eta >= 5 && eta <= 20, `expected 5-20 minutes, got ${eta}`);
});

test('the ETA is rounded to 5 minutes, never falsely precise', () => {
  // "23 minutes" from a straight-line estimate implies precision it
  // does not have.
  const eta = estimateEtaMinutes({
    fromLat: -32.9283, fromLng: 151.7817, toLat: -32.8, toLng: 151.7,
  });
  assert.equal(eta % 5, 0, `${eta} should be a multiple of 5`);
});

test('never under 5 minutes, even at the same address', () => {
  // A vet outside the door still has to park and walk in.
  const eta = estimateEtaMinutes({
    fromLat: -32.9283, fromLng: 151.7817, toLat: -32.9283, toLng: 151.7817,
  });
  assert.equal(eta, 5);
});

test('an absurd distance returns null rather than a silly promise', () => {
  // Newcastle to Perth. Better to say nothing than tell a family
  // "2400 minutes".
  assert.equal(estimateEtaMinutes({
    fromLat: -32.9283, fromLng: 151.7817, toLat: -31.95, toLng: 115.86,
  }), null);
});

test('missing coordinates return null, not NaN', () => {
  // NaN would render as "arriving in NaN minutes" to a grieving client.
  for (const args of [
    { fromLat: null, fromLng: 151, toLat: -32, toLng: 151 },
    { fromLat: -32, fromLng: 151, toLat: undefined, toLng: 151 },
    {},
  ]) {
    assert.equal(estimateEtaMinutes(args), null, JSON.stringify(args));
  }
});
