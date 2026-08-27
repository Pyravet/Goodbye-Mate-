import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceTotals, lineAmount, formatInvoiceNumber, dueDateFor } from './partnerInvoices.js';

const ITEMS = [
  { description: 'Collection & transport', quantity: 12, unitAmount: 80 },
  { description: 'After-hours surcharge', quantity: 2, unitAmount: 45 },
];

test('GST is ADDED, not extracted — the opposite of client invoices', () => {
  // B2B pricing is quoted ex-GST by convention: a partner agreeing "$80
  // per collection" means $80 PLUS GST. Extracting instead would
  // under-bill by an eleventh on every invoice.
  const t = invoiceTotals(ITEMS, { isGstRegistered: true, gstPercent: 10 });
  assert.equal(t.subtotal, 1050, '12*80 + 2*45');
  assert.equal(t.gst, 105, '10% ADDED on top');
  assert.equal(t.total, 1155);
});

test('no GST line at all when the business is not registered', () => {
  // Showing "$0.00 GST" implies a registration that does not exist, on a
  // document the partner will file.
  const t = invoiceTotals(ITEMS, { isGstRegistered: false });
  assert.equal(t.gst, 0);
  assert.equal(t.total, t.subtotal, 'total equals subtotal exactly');
  assert.equal(t.isGstRegistered, false);
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
