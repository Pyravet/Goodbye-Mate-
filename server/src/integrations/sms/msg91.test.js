import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMsg91Mobile } from './msg91.js';

test('toMsg91Mobile: converts AU local format (0...) to country code', () => {
  assert.equal(toMsg91Mobile('0412345678'), '61412345678');
});

test('toMsg91Mobile: strips a leading + from international format', () => {
  assert.equal(toMsg91Mobile('+61412345678'), '61412345678');
});

test('toMsg91Mobile: passes through if already in 61... format with no +', () => {
  assert.equal(toMsg91Mobile('61412345678'), '61412345678');
});

test('toMsg91Mobile: strips spaces/formatting characters', () => {
  assert.equal(toMsg91Mobile('0412 345 678'), '61412345678');
});
