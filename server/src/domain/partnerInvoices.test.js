import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceTotals, lineAmount, formatInvoiceNumber, dueDateFor } from './partnerInvoices.js';

const ITEMS = [
  { description: 'Collection & transport', quantity: 12, unitAmount: 80 },
  { description: 'After-hours surcharge', quantity: 2, unitAmount: 45 },
];

test('INCLUSIVE: the tax is extracted, the total is what was entered', () => {
  // $80 per collection is what the partner PAYS; the GST is already
  // inside it.
  const t = invoiceTotals(ITEMS, { gstMode: 'inclusive', gstPercent: 10 });
  assert.equal(t.total, 1050, 'exactly what was entered');
  assert.equal(t.gst, 95.45, '1050 / 11');
  assert.equal(t.subtotal, 954.55);
});

test('EXCLUSIVE: the tax is added, so the partner pays more', () => {
  const t = invoiceTotals(ITEMS, { gstMode: 'exclusive', gstPercent: 10 });
  assert.equal(t.subtotal, 1050, 'the entered figures are the ex-GST base');
  assert.equal(t.gst, 105, '10% on top');
  assert.equal(t.total, 1155, 'MORE than was entered');
});

test('NONE: no GST line at all, not a zero one', () => {
  // A "$0.00 GST" line implies a registration that may not exist, on a
  // document the partner files with their own accounts.
  const t = invoiceTotals(ITEMS, { gstMode: 'none' });
  assert.equal(t.gst, 0);
  assert.equal(t.total, 1050);
  assert.equal(t.subtotal, t.total);
  assert.equal(t.gstMode, 'none');
});

test('the two modes differ by exactly the tax — and that is the point', () => {
  // Choosing the wrong one misbills by roughly 10% in one direction or
  // the other, which is why it is an explicit per-invoice choice rather
  // than a global default.
  const inc = invoiceTotals(ITEMS, { gstMode: 'inclusive' });
  const exc = invoiceTotals(ITEMS, { gstMode: 'exclusive' });
  assert.notEqual(inc.total, exc.total);
  assert.equal(exc.total - inc.total, 105);
});

test('a zero rate behaves as no GST rather than dividing by zero', () => {
  for (const mode of ['inclusive', 'exclusive']) {
    const t = invoiceTotals(ITEMS, { gstMode: mode, gstPercent: 0 });
    assert.equal(t.gst, 0);
    assert.equal(t.total, 1050, `${mode} with a 0% rate must not alter the total`);
  }
});

test('components always sum to the total', () => {
  for (const items of [ITEMS, [{ quantity: 3, unitAmount: 33.33 }], [{ quantity: 7, unitAmount: 19.99 }]]) {
    const t = invoiceTotals(items, { gstMode: 'inclusive' });
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
    const t = invoiceTotals([{ quantity: 1, unitAmount: amount }], { gstMode: 'inclusive' });
    assert.equal(t.total, amount, `total must stay ${amount}`);
  }
});

test('money never lands on a fraction of a cent', () => {
  const t = invoiceTotals([{ quantity: 3, unitAmount: 33.333 }], { gstMode: 'inclusive' });
  for (const v of [t.subtotal, t.gst, t.total]) {
    assert.equal(Math.round(v * 100), v * 100, `${v} must be whole cents`);
  }
});

test('an empty invoice totals zero rather than NaN', () => {
  const t = invoiceTotals([], { gstMode: 'inclusive' });
  assert.deepEqual([t.subtotal, t.gst, t.total], [0, 0, 0]);
});

test('missing or junk values are treated as zero, not NaN', () => {
  // A half-filled draft must not poison the totals with NaN, which
  // would render as "$NaN" on a document.
  const t = invoiceTotals(
    [{ description: 'x' }, { quantity: 'abc', unitAmount: null }],
    { gstMode: 'inclusive' }
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

  const asDraft = invoiceTotals(items, { gstMode: 'none' });
  assert.equal(asDraft.gst, 0);
  assert.equal(asDraft.total, 1100);

  const atSend = invoiceTotals(items, { gstMode: 'inclusive', gstPercent: 10 });
  assert.equal(atSend.gst, 100, 'GST is disclosed once registered');
  assert.equal(atSend.total, 1100, 'but the partner still pays the same');
});
