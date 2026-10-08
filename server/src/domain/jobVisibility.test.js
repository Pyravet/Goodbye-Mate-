import test from 'node:test';
import assert from 'node:assert/strict';
import { vetSafeJobResponse } from './jobVisibility.js';

const full = {
  job: { id: 'j1' }, review: { rating: 5 },
  referredByPartner: { name: 'Clinic' },
  bill: { total: 498, lines: [] },
  payout: { total: 360 },
  payoutLines: [{ label: 'Euthanasia', amount: 360 }],
};

test('vet response omits the client bill and the referral partner', () => {
  const v = vetSafeJobResponse(full);
  assert.equal('bill' in v, false);
  assert.equal('referredByPartner' in v, false);
  assert.equal(JSON.stringify(v).includes('498'), false);
});
test('vet response keeps job, review, payout and lines', () => {
  const v = vetSafeJobResponse(full);
  assert.deepEqual(v.job, full.job);
  assert.equal(v.payout.total, 360);
  assert.equal(v.payoutLines.length, 1);
  assert.equal(v.review.rating, 5);
});
