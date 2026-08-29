import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeightKg, requiresManualDispatch, chargesTransferFee } from './handling.js';

const PRICING = { manualDispatchWeightKg: 30 };

test('weight parses out of the free-text people actually type', () => {
  // pet_weight is TEXT filled in by whoever took the booking. Failing to
  // parse means a vet turns up alone to lift an animal nobody warned
  // them about.
  for (const [input, expected] of [
    ['35', 35], ['35kg', 35], ['35 kg', 35], ['35KG', 35],
    ['approx 35kg', 35], ['~35 kg', 35], ['35.5kg', 35.5],
    [35, 35], ['800g', 0.8], ['4.2', 4.2],
  ]) {
    assert.equal(parseWeightKg(input), expected, `"${input}"`);
  }
});

test('an unparseable weight returns null, never zero', () => {
  // Zero would read as "very light" and sail past the threshold — the
  // exact opposite of the safe answer.
  for (const bad of ['', null, undefined, 'large', 'unknown', 'big dog']) {
    assert.equal(parseWeightKg(bad), null, `${JSON.stringify(bad)} must be null`);
  }
});

test('30kg and over requires manual assignment', () => {
  assert.equal(requiresManualDispatch({ pet_weight: '29kg' }, PRICING).manual, false);
  assert.equal(requiresManualDispatch({ pet_weight: '30kg' }, PRICING).manual, true,
    'the threshold is inclusive — 30kg is already heavy');
  assert.equal(requiresManualDispatch({ pet_weight: '45kg' }, PRICING).manual, true);
});

test('an UNKNOWN weight also blocks auto-dispatch', () => {
  // "We don't know how heavy it is" must mean a person finds out, not
  // that we assume it's fine.
  const r = requiresManualDispatch({ pet_weight: null }, PRICING);
  assert.equal(r.manual, true);
  assert.match(r.reason, /weight isn't recorded/i);
});

test('nobody able to carry blocks auto-dispatch even for a light pet', () => {
  const r = requiresManualDispatch({ pet_weight: '10kg', handling_help: 'needs_help' }, PRICING);
  assert.equal(r.manual, true, 'the visit cannot proceed until help is arranged');
});

test('a light pet with help arranged dispatches normally', () => {
  for (const help of ['not_needed', 'client_helps', 'direct_pickup']) {
    assert.equal(
      requiresManualDispatch({ pet_weight: '10kg', handling_help: help }, PRICING).manual,
      false, help
    );
  }
});

test('the threshold is configurable', () => {
  const r = requiresManualDispatch({ pet_weight: '25kg' }, { manualDispatchWeightKg: 20 });
  assert.equal(r.manual, true, '25kg is over a 20kg threshold');
  assert.match(r.reason, /20kg limit/);
});

test('direct pickup removes OUR transfer fee', () => {
  // The crematorium partner sends their own driver and bills the client
  // directly. Charging our fee too would be charging for work we are
  // not doing.
  assert.equal(chargesTransferFee({ handling_help: 'direct_pickup' }), false);
  for (const help of ['not_needed', 'client_helps', 'needs_help', undefined]) {
    assert.equal(chargesTransferFee({ handling_help: help }), true, String(help));
  }
});
