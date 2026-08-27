import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceTotals, lineAmount, formatInvoiceNumber, dueDateFor } from './partnerInvoices.js';

const ITEMS = [
  { description: 'Collection & transport', quantity: 12, unitAmount: 80 },
  { description: 'After-hours surcharge', quantity: 2, unitAmount: 45 },
];

test('prices are GST-INCLUSIVE — the tax is extracted, not added', () => {
  // $80 per collection is what the partner PAYS. The GST is the
  // eleventh already inside it. Adding on top would over-bill them by
  // 10% on every invoice.
  const t = invoiceTotals(ITEMS, { isGstRegistered: true, gstPercent: 10 });
  assert.equal(t.total, 1050, '12*80 + 2*45 — exactly what was entered');
  assert.equal(t.gst, 95.45, '1050 / 11');
  assert.equal(t.subtotal, 954.55, 'ex-GST remainder');
});

test('registration changes DISCLOSURE, never the amount charged', () => {
  // The same lines must cost the partner the same either way. Only
  // whether the tax component is shown differs.
  const registered = invoiceTotals(ITEMS, { isGstRegistered: true });
  const not = invoiceTotals(ITEMS, { isGstRegistered: false });

  assert.equal(registered.total, not.total, 'the partner pays the same');
  assert.equal(not.gst, 0, 'no GST line when not registered');
  assert.equal(not.subtotal, not.total, 'subtotal equals total when there is no tax to split out');
});

test('components always sum to the total', () => {
  for (const items of [ITEMS, [{ quantity: 3, unitAmount: 33.33 }], [{ quantity: 7, unitAmount: 19.99 }]]) {
    const t = invoiceTotals(items, { isGstRegistered: true });
    assert.equal(
      Math.round((t.subtotal + t.gst) * 100),
      Math.round(t.total * 100),
      'an invoice whose parts do not sum is not a valid tax invoice'
    );
  }
});

test('the total is never altered by rounding the tax split', () => {
  // Extraction can round; the amount the partner owes must not move
  // because of it.
  for (const amount of [0.01, 3.33, 99.99, 1000.01, 12345.67]) {
    const t = invoiceTotals([{ quantity: 1, unitAmount: amount }], { isGstRegistered: true });
    assert.equal(t.total, amount, `total must stay ${amount}`);
  }
});

test('money never lands on a fraction of a cent', () => {
  const t = invoiceTotals([{ quantity: 3, unitAmount: 33.333 }], { isGstRegistered: true });
  for (const v of [t.subtotal, t.gst, t.total]) {
    assert.equal(Math.round(v * 100), v * 100, `${v} must be whole cents`);
  }
});

test('an empty invoice totals zero rather than NaN', () => {
  const t = invoiceTotals([], { isGstRegistered: true });
  assert.deepEqual([t.subtotal, t.gst, t.total], [0, 0, 0]);
});

test('missing or junk values are treated as zero, not NaN', () => {
  // A half-filled draft must not poison the totals with NaN, which
  // would render as "$NaN" on a document.
  const t = invoiceTotals(
    [{ description: 'x' }, { quantity: 'abc', unitAmount: null }],
    { isGstRegistered: true }
  );
  assert.equal(t.total, 0);
  assert.ok(Number.isFinite(t.total));
});

test('line amounts multiply quantity by unit price', () => {
  assert.equal(lineAmount(12, 80), 960);
  assert.equal(lineAmount(0.5, 100), 50, 'fractional quantities work');
  assert.equal(lineAmount(1, -50), -50, 'negatives allowed for a credit line');
});

test('invoice numbers are padded and distinguishable from other series', () => {
  assert.equal(formatInvoiceNumber(1), 'INV-00001');
  assert.equal(formatInvoiceNumber(42), 'INV-00042');
  // Must not be confusable with a job (GM-) or an RCTI (RCTI-).
  assert.ok(formatInvoiceNumber(1).startsWith('INV-'));
});

test('due date adds the agreed terms', () => {
  assert.equal(dueDateFor('2026-09-15', 14), '2026-09-29');
  assert.equal(dueDateFor('2026-09-15', 30), '2026-10-15', 'crosses a month boundary');
  assert.equal(dueDateFor('2026-12-28', 14), '2027-01-11', 'crosses a year boundary');
  assert.equal(dueDateFor('not-a-date', 14), null, 'bad input returns null, not Invalid Date');
});

test('a draft written before GST registration recomputes at send', () => {
  // Totals are stored at create and recomputed once, at send. What
  // changes is the DISCLOSED tax, not the amount owed.
  const items = [{ quantity: 1, unitAmount: 1100 }];

  const asDraft = invoiceTotals(items, { isGstRegistered: false });
  assert.equal(asDraft.gst, 0);
  assert.equal(asDraft.total, 1100);

  const atSend = invoiceTotals(items, { isGstRegistered: true, gstPercent: 10 });
  assert.equal(atSend.gst, 100, 'GST is disclosed once registered');
  assert.equal(atSend.total, 1100, 'but the partner still pays the same');
});
