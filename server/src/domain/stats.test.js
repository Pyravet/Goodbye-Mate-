import test from 'node:test';
import assert from 'node:assert/strict';
import { periodKey, statsByPeriod, statsByLocation, statsByVet, summaryStats } from './stats.js';

// --- periodKey ---

test('month and year keys are straightforward', () => {
  assert.equal(periodKey('2026-03-15', 'month'), '2026-03');
  assert.equal(periodKey('2026-03-15', 'year'), '2026');
});

test('ISO week handles a year boundary correctly', () => {
  // 30 Dec 2024 was a Monday and belongs to ISO week 1 of 2025, not
  // week 53 of 2024 — this is the exact case a naive "week of year"
  // calculation gets wrong, and it's the one worth asserting.
  assert.equal(periodKey('2024-12-30', 'week'), '2025-W01');
  // 1 Jan 2023 was a Sunday and belongs to the LAST week of 2022.
  assert.equal(periodKey('2023-01-01', 'week'), '2022-W52');
});

test('a Date object and a string produce the same key', () => {
  assert.equal(periodKey(new Date('2026-03-15T00:00:00'), 'month'), periodKey('2026-03-15', 'month'));
});

// --- statsByPeriod ---

test('completed, cancelled and other are counted separately, not folded together', () => {
  const jobs = [
    { job_date: '2026-03-01', status: 'completed', billTotal: 449 },
    { job_date: '2026-03-05', status: 'cancelled', cancellation_fee: 50 },
    { job_date: '2026-03-10', status: 'assigned' },
  ];
  const [march] = statsByPeriod(jobs, 'month');
  assert.equal(march.total, 3);
  assert.equal(march.completed, 1);
  assert.equal(march.cancelled, 1);
  assert.equal(march.other, 1);
});

test('revenue only counts COMPLETED jobs, never a cancelled one\'s would-have-been total', () => {
  const jobs = [
    { job_date: '2026-03-01', status: 'completed', billTotal: 449 },
    { job_date: '2026-03-02', status: 'cancelled', billTotal: 449, cancellation_fee: 50 },
  ];
  const [march] = statsByPeriod(jobs, 'month');
  assert.equal(march.revenue, 449, 'the cancelled job\'s billTotal must not leak into revenue');
  assert.equal(march.cancellationFees, 50);
});

test('periods are sorted chronologically', () => {
  const jobs = [
    { job_date: '2026-06-01', status: 'completed', billTotal: 100 },
    { job_date: '2026-01-01', status: 'completed', billTotal: 100 },
    { job_date: '2026-03-01', status: 'completed', billTotal: 100 },
  ];
  const periods = statsByPeriod(jobs, 'month').map((p) => p.period);
  assert.deepEqual(periods, ['2026-01', '2026-03', '2026-06']);
});

// --- statsByLocation ---

test('groups by the requested field and sorts by revenue descending', () => {
  const jobs = [
    { state: 'NSW', status: 'completed', billTotal: 300 },
    { state: 'NSW', status: 'completed', billTotal: 300 },
    { state: 'VIC', status: 'completed', billTotal: 1000 },
  ];
  const result = statsByLocation(jobs, 'state');
  assert.equal(result[0].location, 'VIC', 'highest revenue first');
  assert.equal(result[0].revenue, 1000);
  assert.equal(result[1].location, 'NSW');
  assert.equal(result[1].revenue, 600);
});

test('a non-completed job counts toward totalJobs but not revenue', () => {
  const jobs = [
    { state: 'NSW', status: 'completed', billTotal: 300 },
    { state: 'NSW', status: 'cancelled', billTotal: 300 },
  ];
  const [nsw] = statsByLocation(jobs, 'state');
  assert.equal(nsw.totalJobs, 2, 'operational count includes everything');
  assert.equal(nsw.completedJobs, 1);
  assert.equal(nsw.revenue, 300, 'only the completed one billed');
});

test('a missing location field is grouped as Unknown rather than dropped', () => {
  const jobs = [{ state: null, status: 'completed', billTotal: 100 }];
  const result = statsByLocation(jobs, 'state');
  assert.equal(result[0].location, 'Unknown');
});

// --- statsByVet ---

test('a job with no assigned vet is excluded, not grouped under undefined', () => {
  const jobs = [
    { assigned_vet_id: 'v1', vetName: 'Dr A', status: 'completed', billTotal: 300 },
    { assigned_vet_id: null, status: 'completed', billTotal: 500 },
  ];
  const result = statsByVet(jobs);
  assert.equal(result.length, 1);
  assert.equal(result[0].vetId, 'v1');
});

test('revenue per vet is what they BILLED, not their own payout', () => {
  // The payout figure already exists elsewhere; this module intentionally
  // reports a different number so the two are never read as the same
  // thing side by side.
  const jobs = [{ assigned_vet_id: 'v1', vetName: 'Dr A', status: 'completed', billTotal: 449 }];
  const [vet] = statsByVet(jobs);
  assert.equal(vet.revenue, 449);
});

// --- summaryStats ---

test('netRevenue accounts for cancellation fees in and refunds out', () => {
  const jobs = [
    { status: 'completed', billTotal: 449, refunded_amount: 0 },
    { status: 'cancelled', cancellation_fee: 50, refunded_amount: 0 },
    { status: 'completed', billTotal: 300, refunded_amount: 300 }, // fully refunded
  ];
  const s = summaryStats(jobs);
  assert.equal(s.revenue, 749, 'both completed jobs\' totals');
  assert.equal(s.cancellationFees, 50);
  assert.equal(s.refunded, 300);
  assert.equal(s.netRevenue, 499, '749 + 50 - 300');
});

test('averageJobValue is 0 with no completed jobs, not NaN or a crash', () => {
  const s = summaryStats([{ status: 'cancelled', cancellation_fee: 50 }]);
  assert.equal(s.averageJobValue, 0);
});

test('summary counts match the raw job list exactly', () => {
  const jobs = [
    { status: 'completed', billTotal: 100 },
    { status: 'completed', billTotal: 200 },
    { status: 'cancelled' },
    { status: 'assigned' },
  ];
  const s = summaryStats(jobs);
  assert.equal(s.totalJobs, 4);
  assert.equal(s.completedJobs, 2);
  assert.equal(s.cancelledJobs, 1);
});
