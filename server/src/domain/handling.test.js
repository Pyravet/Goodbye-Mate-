import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeightKg, requiresManualDispatch, chargesTransferFee, chargesAssistantFee } from './handling.js';

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

// --- The paid options when nobody can help ---

test("'nobody can help' is unresolved, not a refusal", () => {
  // The family isn't turned away — they're offered a direct pickup or a
  // second person. Until they choose, the job can't be costed or
  // staffed, so it must not auto-dispatch.
  const r = requiresManualDispatch({ pet_weight: '10kg', handling_help: 'needs_help' }, PRICING);
  assert.equal(r.manual, true);
  assert.match(r.reason, /direct pickup or an extra person/i,
    'the reason should name the options, not just state a problem');
});

test('sending an assistant is a normal, dispatchable job', () => {
  // Once they've chosen, it's staffed and priced — nothing further to
  // resolve, so it can be offered like any other job.
  const r = requiresManualDispatch({ pet_weight: '10kg', handling_help: 'assistant' }, PRICING);
  assert.equal(r.manual, false);
});

test('a heavy pet still needs manual assignment even with an assistant', () => {
  // The assistant answers "who lifts it", not "does the vet know what
  // they're accepting". A 45kg dog is still a conversation.
  const r = requiresManualDispatch({ pet_weight: '45kg', handling_help: 'assistant' }, PRICING);
  assert.equal(r.manual, true);
});

test('the assistant fee applies only when an assistant is sent', () => {
  assert.equal(chargesAssistantFee({ handling_help: 'assistant' }), true);
  for (const h of ['not_needed', 'client_helps', 'direct_pickup', 'needs_help', undefined]) {
    assert.equal(chargesAssistantFee({ handling_help: h }), false, String(h));
  }
});

test('direct pickup and the assistant fee are mutually exclusive in practice', () => {
  // One removes our transport, the other adds labour to it. A job can
  // never legitimately do both.
  const pickup = { handling_help: 'direct_pickup' };
  const assisted = { handling_help: 'assistant' };
  assert.equal(chargesTransferFee(pickup), false);
  assert.equal(chargesAssistantFee(pickup), false);
  assert.equal(chargesTransferFee(assisted), true, 'we still do the transport');
  assert.equal(chargesAssistantFee(assisted), true);
});

// --- Multi-pet weight ---

test('the HEAVIEST pet decides, not the first', () => {
  // A 5kg cat booked alongside a 45kg dog. job.pet_weight mirrors the
  // first pet, so this looked light and dispatched automatically — the
  // vet arriving alone to a 45kg dog with no warning.
  const job = { pet_weight: '5kg', pet_name: 'Mittens', handling_help: 'client_helps' };
  const pets = [{ name: 'Mittens', weight: '5kg' }, { name: 'Rex', weight: '45kg' }];

  const r = requiresManualDispatch(job, PRICING, pets);
  assert.equal(r.manual, true, 'the 45kg dog must hold the job back');
  assert.equal(r.weightKg, 45, 'the heaviest weight is reported, not the first');
  assert.match(r.reason, /Rex/, 'the reason must name which animal, so admin knows who to ask about');
});

test('order does not matter — heavy first or heavy second', () => {
  const job = { pet_weight: '45kg', handling_help: 'client_helps' };
  const reversed = [{ name: 'Rex', weight: '45kg' }, { name: 'Mittens', weight: '5kg' }];
  assert.equal(requiresManualDispatch(job, PRICING, reversed).manual, true);
});

test('two light pets still dispatch normally', () => {
  const job = { pet_weight: '5kg', handling_help: 'client_helps' };
  const pets = [{ name: 'Mittens', weight: '5kg' }, { name: 'Socks', weight: '4kg' }];
  assert.equal(requiresManualDispatch(job, PRICING, pets).manual, false);
});

test('one unknown weight among several holds the job', () => {
  // "We know the cat is 5kg but nobody weighed the dog" must not pass
  // as light — that's the case most likely to surprise a vet.
  const job = { pet_weight: '5kg', handling_help: 'client_helps' };
  const pets = [{ name: 'Mittens', weight: '5kg' }, { name: 'Rex', weight: null }];
  const r = requiresManualDispatch(job, PRICING, pets);
  assert.equal(r.manual, true);
  assert.match(r.reason, /Rex/, 'names the pet whose weight is missing');
});

test('called without a pet list, it still behaves as before', () => {
  // Every caller should pass pets, but a missed one must not silently
  // start dispatching heavy animals.
  const job = { pet_weight: '45kg', handling_help: 'client_helps' };
  assert.equal(requiresManualDispatch(job, PRICING).manual, true);
});
