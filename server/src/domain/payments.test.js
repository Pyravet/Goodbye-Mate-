import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentPosition } from './payments.js';

test('nothing paid: the whole bill is due', () => {
  assert.deepEqual(paymentPosition(498, 0), { total: 498, paid: 0, due: 498, credit: 0 });
});
test('paid in full, then an extra: only the extra is due', () => {
  assert.deepEqual(paymentPosition(548, 498), { total: 548, paid: 498, due: 50, credit: 0 });
});
test('a discount after payment leaves a credit, never a negative due', () => {
  assert.deepEqual(paymentPosition(468, 498), { total: 468, paid: 498, due: 0, credit: 30 });
});
test('refunds reduce what counts as paid', () => {
  assert.equal(paymentPosition(498, 498 - 100).due, 100);
});
test('cents are rounded, not floated', () => {
  assert.equal(paymentPosition(10.1 + 0.2, 0).due, 10.3);
});
