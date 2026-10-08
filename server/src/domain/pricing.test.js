import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billBreakdown, payoutBreakdown, extractGst, suggestTimeCategory , clientGstSplit, payoutBreakdownLines } from './pricing.js';

const pricing = {
  services: [
    { id: 'euth', name: 'Euthanasia', clientPrice: 300, vetWeekday: 150, vetAfterhours: 200 },
  ],
  transferFee: { clientPrice: 50, vetWeekday: 30, vetAfterhours: 40 },
  afterHoursSurcharge: 100,
  publicHolidaySurcharge: 129,
  midnightFeeSurcharge: 149,
  communalCremationFee: 80,
  gstPercent: 10,
};

const baseJob = {
  service_id: 'euth',
  service_type: 'euthanasia_only',
  time_category: 'weekday',
  job_time: '14:00',
  is_public_holiday: false,
  extra_travel_fee: 0,
};

test('billBreakdown: plain weekday job is just service + transfer fee', () => {
  const { lines, total } = billBreakdown(baseJob, pricing);
  assert.equal(total, 350); // 300 + 50
  assert.equal(lines.length, 2);
});

test('billBreakdown: after-hours adds the surcharge line', () => {
  const job = { ...baseJob, time_category: 'afterhours_weekend' };
  const { total, lines } = billBreakdown(job, pricing);
  assert.equal(total, 450); // 300 + 50 + 100
  assert.ok(lines.some((l) => l.label.includes('After hours')));
});

test('billBreakdown: public holiday and midnight surcharges stack independently', () => {
  const job = { ...baseJob, job_time: '02:00', is_public_holiday: true };
  const { total, lines } = billBreakdown(job, pricing);
  assert.equal(total, 300 + 50 + 129 + 149);
  assert.ok(lines.some((l) => l.label.includes('Public holiday')));
  assert.ok(lines.some((l) => l.label.includes('Midnight')));
});

test('billBreakdown: communal cremation and travel fee add their own lines', () => {
  const job = { ...baseJob, service_type: 'communal_cremation', extra_travel_fee: 25 };
  const { total } = billBreakdown(job, pricing);
  assert.equal(total, 300 + 50 + 80 + 25);
});

test('payoutBreakdown: weekday vs after-hours pays the vet different rates', () => {
  const weekday = payoutBreakdown(baseJob, pricing);
  assert.equal(weekday.total, 150 + 30);

  const afterHours = payoutBreakdown({ ...baseJob, time_category: 'afterhours_weekend' }, pricing);
  assert.equal(afterHours.total, 200 + 40);
});

test('extractGst: extracts GST from a GST-inclusive total, does not add on top', () => {
  const { gstAmount, exGstAmount } = extractGst(110, 10);
  assert.equal(gstAmount, 10);
  assert.equal(exGstAmount, 100);
});

test('suggestTimeCategory: weekend is always after-hours regardless of time', () => {
  // 2026-08-15 is a Saturday
  assert.equal(suggestTimeCategory('2026-08-15', '11:00'), 'afterhours_weekend');
});

test('suggestTimeCategory: weekday business hours is weekday', () => {
  // 2026-08-17 is a Monday
  assert.equal(suggestTimeCategory('2026-08-17', '11:00'), 'weekday');
});

test('suggestTimeCategory: weekday evening is after-hours', () => {
  assert.equal(suggestTimeCategory('2026-08-17', '19:00'), 'afterhours_weekend');
});

// --- Line items: ad-hoc extras and discounts ---

test('billBreakdown: adds extra charges to the client total', () => {
  const bill = billBreakdown(baseJob, pricing, [
    { label: 'Large pet handling', amount: 60, vet_payout: 40 },
    { label: 'Extra time on site', amount: 45, vet_payout: 45 },
  ]);
  const withoutItems = billBreakdown(baseJob, pricing).total;
  assert.equal(bill.total, withoutItems + 105);
  assert.ok(bill.lines.some((l) => l.label === 'Large pet handling'));
});

test('billBreakdown: a discount is a negative line item and reduces the total', () => {
  const withoutItems = billBreakdown(baseJob, pricing).total;
  const bill = billBreakdown(baseJob, pricing, [
    { label: 'Goodwill discount', amount: -50, vet_payout: 0 },
  ]);
  assert.equal(bill.total, withoutItems - 50);
});

test('billBreakdown: totals avoid floating point drift', () => {
  const bill = billBreakdown(baseJob, pricing, [
    { label: 'Odd charge', amount: 0.1, vet_payout: 0 },
    { label: 'Another', amount: 0.2, vet_payout: 0 },
  ]);
  // 0.1 + 0.2 === 0.30000000000000004 in raw float maths; the rounding
  // in billBreakdown must prevent that reaching an invoice.
  const cents = Math.round(bill.total * 100);
  assert.equal(cents, bill.total * 100);
});

test('payoutBreakdown: vet is paid only the vet_payout portion, not the client amount', () => {
  const payout = payoutBreakdown(baseJob, pricing, [
    { label: 'Large pet handling', amount: 60, vet_payout: 40 },
  ]);
  const without = payoutBreakdown(baseJob, pricing).total;
  // Vet gets 40, not the 60 the client was charged.
  assert.equal(payout.total, without + 40);
});

test('payoutBreakdown: a client discount does not reduce the vet payout', () => {
  const without = payoutBreakdown(baseJob, pricing).total;
  const payout = payoutBreakdown(baseJob, pricing, [
    { label: 'Goodwill discount', amount: -50, vet_payout: 0 },
  ]);
  assert.equal(payout.total, without);
});

// --- Client-facing GST ---

test('clientGstSplit: no GST when the business is not registered', () => {
  const r = clientGstSplit(449, { isGstRegistered: false, gstPercent: 10 });
  assert.equal(r.gst, 0);
  assert.equal(r.subtotal, 449);
  assert.equal(r.total, 449);
});

test('clientGstSplit: GST is EXTRACTED from an inclusive total, not added', () => {
  // Prices in settings are what the client pays, so a $550 total must
  // stay $550 — adding 10% on top would silently raise every price.
  const r = clientGstSplit(550, { isGstRegistered: true, gstPercent: 10 });
  assert.equal(r.total, 550);
  assert.equal(r.gst, 50);
  assert.equal(r.subtotal, 500);
});

test('clientGstSplit: components always re-add to the total exactly', () => {
  for (const amt of [449, 498, 1234.55, 0.05, 987.65]) {
    const r = clientGstSplit(amt, { isGstRegistered: true, gstPercent: 10 });
    assert.equal(
      Math.round((r.subtotal + r.gst) * 100),
      Math.round(r.total * 100),
      `must reconcile for ${amt}`
    );
  }
});

test('clientGstSplit: honours a non-default GST rate', () => {
  const r = clientGstSplit(115, { isGstRegistered: true, gstPercent: 15 });
  assert.equal(r.total, 115);
  assert.equal(r.gst, 15);
  assert.equal(r.subtotal, 100);
});

// --- Oversize pet fee ---

test('bill includes the oversize fee for a heavy pet', () => {
  const withOversize = { ...pricing, manualDispatchWeightKg: 30, oversizeFee: { clientPrice: 60, vetPayout: 45 } };
  const job = { ...baseJob, pet_weight: '35kg' };
  const bill = billBreakdown(job, withOversize);
  const line = bill.lines.find((l) => l.label === 'Oversize pet fee');
  assert.ok(line, 'expected an Oversize pet fee line');
  assert.equal(line.amount, 60);
});

test('bill has NO oversize line for a light pet', () => {
  const withOversize = { ...pricing, manualDispatchWeightKg: 30, oversizeFee: { clientPrice: 60, vetPayout: 45 } };
  const job = { ...baseJob, pet_weight: '10kg' };
  const bill = billBreakdown(job, withOversize);
  assert.equal(bill.lines.some((l) => l.label === 'Oversize pet fee'), false);
});

test('payout carries oversizeAmt and folds it into the total', () => {
  const withOversize = { ...pricing, manualDispatchWeightKg: 30, oversizeFee: { clientPrice: 60, vetPayout: 45 } };
  const job = { ...baseJob, pet_weight: '35kg' };
  const withoutFee = payoutBreakdown(job, pricing);
  const withFee = payoutBreakdown(job, withOversize);
  assert.equal(withFee.oversizeAmt, 45);
  assert.equal(withFee.total, withoutFee.total + 45, 'total must increase by exactly the vet payout');
});

test('the oversize fee and the assistant fee are independent — both can apply at once', () => {
  // A heavy pet AND a booked assistant are two separate real costs; one
  // must not silently substitute for or suppress the other.
  const cfg = {
    ...pricing,
    manualDispatchWeightKg: 30,
    oversizeFee: { clientPrice: 60, vetPayout: 45 },
    assistantFee: { clientPrice: 90, vetPayout: 70 },
  };
  const job = { ...baseJob, pet_weight: '35kg', handling_help: 'assistant' };
  const bill = billBreakdown(job, cfg);
  assert.ok(bill.lines.some((l) => l.label === 'Oversize pet fee'));
  assert.ok(bill.lines.some((l) => l.label === 'Extra person to assist'));

  const payout = payoutBreakdown(job, cfg);
  assert.equal(payout.oversizeAmt, 45);
  assert.equal(payout.assistantAmt, 70);
});

test('a heavy pet among several on one job still charges the fee once, not per pet', () => {
  // One oversize fee per VISIT, not per animal — it compensates for the
  // extra difficulty of that one heavy pet, not a multiplier on the
  // whole job the way the euthanasia service fee is.
  const withOversize = { ...pricing, manualDispatchWeightKg: 30, oversizeFee: { clientPrice: 60, vetPayout: 45 } };
  const job = { ...baseJob, pet_weight: '4kg', petCount: 2, pets: [{ weight: '4kg' }, { weight: '40kg' }] };
  const bill = billBreakdown(job, withOversize);
  const lines = bill.lines.filter((l) => l.label === 'Oversize pet fee');
  assert.equal(lines.length, 1, 'exactly one oversize line, regardless of pet count');
  assert.equal(lines[0].amount, 60);
});

test('payoutBreakdownLines: per-pet service, extras itemised, zero lines dropped', () => {
  const lines = payoutBreakdownLines({
    serviceName: 'Euthanasia', petCount: 2, serviceAmt: 680, transferAmt: 20,
    assistantAmt: 0, oversizeAmt: 50, travelAmt: 0,
    lineItems: [{ label: 'Goodwill', vetPayout: 10 }],
  });
  assert.deepEqual(lines.map((l) => l.label), ['Euthanasia × 2', 'Transfer', 'Oversize pet fee', 'Goodwill']);
  assert.equal(lines.reduce((s, l) => s + l.amount, 0), 760);
});
test('payoutBreakdownLines: single pet has no multiplier', () => {
  const lines = payoutBreakdownLines({ serviceName: 'Euthanasia', petCount: 1, serviceAmt: 340, transferAmt: 0, assistantAmt: 0, oversizeAmt: 0, travelAmt: 0, lineItems: [] });
  assert.deepEqual(lines, [{ label: 'Euthanasia', amount: 340 }]);
});
