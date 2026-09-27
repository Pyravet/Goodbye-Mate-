import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCommission, describeCommission } from './referralCommission.js';

test('flat commission is the same regardless of job size', () => {
  const partner = { commission_type: 'flat', commission_value: 30 };
  assert.equal(calculateCommission(449, partner), 30);
  assert.equal(calculateCommission(900, partner), 30);
});

test('percentage commission scales with the job total', () => {
  const partner = { commission_type: 'percentage', commission_value: 8 };
  assert.equal(calculateCommission(450, partner), 36);
  assert.equal(calculateCommission(900, partner), 72);
});

test('zero or missing commission_value owes nothing', () => {
  assert.equal(calculateCommission(450, { commission_type: 'flat', commission_value: 0 }), 0);
  assert.equal(calculateCommission(450, { commission_type: 'flat' }), 0);
  assert.equal(calculateCommission(450, null), 0);
});

test('a flat rate can never exceed the job total', () => {
  // A config typo — $4500 instead of $45 — must not owe a partner more
  // than the client actually paid.
  const partner = { commission_type: 'flat', commission_value: 4500 };
  assert.equal(calculateCommission(450, partner), 450);
});

test('rounds to the cent', () => {
  const partner = { commission_type: 'percentage', commission_value: 8.333 };
  const result = calculateCommission(449, partner);
  assert.equal(result, Math.round(result * 100) / 100);
});

test('describeCommission explains percentage with its working shown', () => {
  const partner = { commission_type: 'percentage', commission_value: 8 };
  assert.equal(describeCommission(450, partner), '8% of $450.00');
});

test('describeCommission explains a flat rate plainly', () => {
  const partner = { commission_type: 'flat', commission_value: 30 };
  assert.equal(describeCommission(450, partner), 'Flat rate ($30.00)');
});
