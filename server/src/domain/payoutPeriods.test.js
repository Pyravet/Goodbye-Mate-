import test from 'node:test';
import assert from 'node:assert/strict';
import {
  periodStartFor,
  periodEndFor,
  formatRctiNumber,
  splitGst,
  WEEKDAYS,
} from './payoutPeriods.js';

// --- Period boundaries (Monday default) ---

test('periodStartFor: a Monday is its own period start', () => {
  // 2026-08-17 is a Monday.
  assert.equal(periodStartFor('2026-08-17', WEEKDAYS.monday), '2026-08-17');
});

test('periodStartFor: mid-week rolls back to the Monday', () => {
  // Wednesday 2026-08-19 belongs to the week starting Monday 17th.
  assert.equal(periodStartFor('2026-08-19', WEEKDAYS.monday), '2026-08-17');
});

test('periodStartFor: Sunday belongs to the PREVIOUS Monday, not the next', () => {
  // The classic off-by-one: Sunday 2026-08-23 must close out the week
  // that began Monday the 17th, not open a new one.
  assert.equal(periodStartFor('2026-08-23', WEEKDAYS.monday), '2026-08-17');
});

test('periodStartFor: works across a month boundary', () => {
  // Tuesday 2026-09-01 belongs to the week starting Monday 2026-08-31.
  assert.equal(periodStartFor('2026-09-01', WEEKDAYS.monday), '2026-08-31');
});

test('periodStartFor: honours a configured non-Monday week start', () => {
  // With weeks starting Sunday, Sunday 2026-08-23 opens its own week.
  assert.equal(periodStartFor('2026-08-23', WEEKDAYS.sunday), '2026-08-23');
  // ...and the following Wednesday still belongs to it.
  assert.equal(periodStartFor('2026-08-26', WEEKDAYS.sunday), '2026-08-23');
});

test('periodEndFor: period is 7 days inclusive', () => {
  assert.equal(periodEndFor('2026-08-17'), '2026-08-23');
});

test('period boundaries tile without gaps or overlaps', () => {
  // Every day in a 4-week span must land in exactly one period, and
  // consecutive periods must be contiguous.
  const seen = new Set();
  let cursor = '2026-08-17';
  for (let w = 0; w < 4; w++) {
    const end = periodEndFor(cursor);
    const d = new Date(`${cursor}T00:00:00Z`);
    for (let i = 0; i < 7; i++) {
      const day = d.toISOString().slice(0, 10);
      assert.equal(periodStartFor(day, WEEKDAYS.monday), cursor, `${day} should map to ${cursor}`);
      assert.ok(!seen.has(day), `${day} counted twice`);
      seen.add(day);
      d.setUTCDate(d.getUTCDate() + 1);
    }
    // Next period starts the day after this one ends.
    assert.equal(d.toISOString().slice(0, 10), new Date(`${end}T00:00:00Z`).toISOString().slice(0, 10).replace(end, d.toISOString().slice(0, 10)));
    cursor = d.toISOString().slice(0, 10);
  }
  assert.equal(seen.size, 28);
});

test('periodStartFor: is timezone-safe for dates that shift under UTC', () => {
  // A date string must always map to the same period regardless of the
  // machine's local timezone — this is why the implementation parses as
  // UTC rather than using local Date construction.
  assert.equal(periodStartFor('2026-08-23', WEEKDAYS.monday), '2026-08-17');
  assert.equal(periodStartFor('2026-08-24', WEEKDAYS.monday), '2026-08-24');
});

// --- RCTI numbering ---

test('formatRctiNumber: zero-pads so numbers sort as text', () => {
  assert.equal(formatRctiNumber('RCTI-', 1), 'RCTI-00001');
  assert.equal(formatRctiNumber('RCTI-', 42), 'RCTI-00042');
  // Sorting as strings must match numeric order.
  const nums = [1, 2, 10, 100].map((n) => formatRctiNumber('RCTI-', n));
  assert.deepEqual([...nums].sort(), nums);
});

// --- GST ---

test('splitGst: non-registered vet has no GST component', () => {
  const r = splitGst(500, false);
  assert.equal(r.gst, 0);
  assert.equal(r.subtotal, 500);
  assert.equal(r.total, 500);
});

test('splitGst: registered vet — GST is 1/11th of the inclusive total', () => {
  const r = splitGst(1100, true);
  assert.equal(r.gst, 100);
  assert.equal(r.subtotal, 1000);
  assert.equal(r.total, 1100);
});

test('splitGst: components always re-add to the total exactly', () => {
  // Rounding must never leave the invoice a cent out — an RCTI whose
  // parts don't sum to its total is not a valid tax document.
  for (const amount of [449, 500.05, 1234.56, 0.05, 987.65]) {
    const r = splitGst(amount, true);
    assert.equal(
      Math.round((r.subtotal + r.gst) * 100),
      Math.round(r.total * 100),
      `subtotal + gst must equal total for ${amount}`
    );
  }
});
