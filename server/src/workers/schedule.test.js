import test from 'node:test';
import assert from 'node:assert/strict';
import { withinWorkingHours, createBurstGate, estimateComputeHours } from './schedule.js';

/**
 * These exist because the failure they prevent took the whole system
 * down: continuous polling kept Neon's compute awake 24/7, burning 720
 * compute-hours a month against a ~191 allowance. Nobody could log in.
 */

test('workers stay off the database overnight', () => {
  // Roughly 7 hours a night of genuine idle time — the compute can
  // suspend, which is the entire point.
  const at = (h) => new Date(`2026-09-15T${String(h).padStart(2, '0')}:00:00+10:00`);
  assert.equal(withinWorkingHours(at(3)), false, '3am');
  assert.equal(withinWorkingHours(at(5)), false, '5am');
  assert.equal(withinWorkingHours(at(6)), true, '6am — first working hour');
  assert.equal(withinWorkingHours(at(14)), true, '2pm');
  assert.equal(withinWorkingHours(at(22)), true, '10pm — still working');
  assert.equal(withinWorkingHours(at(23)), false, '11pm — stopped');
});

test('a burst runs, then leaves a real gap', () => {
  // A gap SHORTER than Neon's ~5 minute suspend delay is worthless: the
  // compute never sleeps. The gap has to be genuinely long.
  const gate = createBurstGate({ windowMinutes: 15, burstSeconds: 60 });
  const t = new Date('2026-09-15T14:00:00+10:00').getTime();

  assert.equal(gate.allow(false, t), true, 'burst opens');
  assert.equal(gate.allow(false, t + 30_000), true, 'still inside the burst');
  assert.equal(gate.allow(false, t + 120_000), false, 'gap begins');
  assert.equal(gate.allow(false, t + 10 * 60_000), false, 'still in the gap');
  assert.equal(gate.allow(false, t + 16 * 60_000), true, 'next window');
});

test('a real event never waits for a window', () => {
  // Dispatch also runs directly on booking, decline and reassignment.
  // If forcing didn't work, a family would wait up to 15 minutes for a
  // vet to be asked.
  const gate = createBurstGate({ windowMinutes: 15, burstSeconds: 60 });
  const t = new Date('2026-09-15T14:00:00+10:00').getTime();
  gate.allow(false, t);
  assert.equal(gate.allow(true, t + 120_000), true, 'forced runs mid-gap');
  assert.equal(gate.allow(true, new Date('2026-09-15T03:00:00+10:00').getTime()), true,
    'forced runs at 3am too');
});

test('the schedule fits a realistic compute budget', () => {
  // The number that matters. If this ever climbs back toward 720, the
  // outage is coming back.
  const dispatch = estimateComputeHours({ windowMinutes: 15, burstSeconds: 60, activeHoursPerDay: 17 });
  const reminders = estimateComputeHours({ windowMinutes: 60, burstSeconds: 60, activeHoursPerDay: 17 });

  assert.ok(dispatch < 250, `dispatch ${dispatch}h should be far below the old 720`);
  assert.ok(reminders < 100, `reminders ${reminders}h`);
  assert.ok(dispatch + reminders < 300, 'combined must fit a paid tier with room to spare');
});
