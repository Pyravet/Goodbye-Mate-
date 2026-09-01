import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAssessment, interpretScore, QOL_CATEGORIES, MAX_SCORE } from './qol.js';

const answer = (n) => Object.fromEntries(QOL_CATEGORIES.map((c) => [c.key, n]));

test('eight categories, scored out of 40', () => {
  assert.equal(QOL_CATEGORIES.length, 8);
  assert.equal(MAX_SCORE, 40);
  assert.equal(scoreAssessment(answer(5)).total, 40);
  assert.equal(scoreAssessment(answer(0)).total, 0);
});

test('an incomplete assessment gives NO total', () => {
  // 18 out of 40 means something very different from 18 out of 25.
  // Showing a partial total as though it were complete would mislead
  // someone at the worst possible moment.
  const partial = answer(3);
  delete partial.eating;
  const r = scoreAssessment(partial);
  assert.equal(r.complete, false);
  assert.equal(r.total, null);
  assert.equal(r.interpretation, null);
});

test('out-of-range answers are treated as unanswered, not clamped', () => {
  // Silently turning a 9 into a 5 would invent an answer the family
  // never gave.
  for (const bad of [-1, 6, 'x', null]) {
    const a = { ...answer(3), ouch: bad };
    assert.equal(scoreAssessment(a).complete, false, String(bad));
  }
});

test('no band ever tells someone to euthanise', () => {
  // The single most important property here. Software does not get to
  // say that to someone about their dog.
  for (let total = 0; total <= MAX_SCORE; total++) {
    const { headline, body } = interpretScore(total);
    const text = `${headline} ${body}`.toLowerCase();
    for (const word of ['euthanas', 'put to sleep', 'put down', 'time to say goodbye', 'let them go']) {
      assert.ok(!text.includes(word), `score ${total} must not contain "${word}"`);
    }
  }
});

test('every band points back to a vet', () => {
  // A number cannot examine an animal. Each band must send them to
  // someone who can.
  for (let total = 0; total <= MAX_SCORE; total++) {
    const { body } = interpretScore(total);
    assert.match(body, /vet/i, `score ${total} must mention a vet`);
  }
});

test('the bands get more urgent as the score falls', () => {
  assert.equal(interpretScore(40).band, 'good');
  assert.equal(interpretScore(30).band, 'good');
  assert.equal(interpretScore(29).band, 'watch');
  assert.equal(interpretScore(21).band, 'watch');
  assert.equal(interpretScore(20).band, 'concern');
  assert.equal(interpretScore(13).band, 'concern');
  assert.equal(interpretScore(12).band, 'urgent');
  assert.equal(interpretScore(0).band, 'urgent');
});

test('the worst areas are surfaced separately from the total', () => {
  // A total of 24 made of eight 3s is a different situation from one
  // where breathing scores 0 — and the second is what a vet needs to
  // hear about first.
  const a = { ...answer(4), respiration: 0, ouch: 1 };
  const r = scoreAssessment(a);
  assert.deepEqual(r.lowest.map((c) => c.key), ['respiration', 'ouch'], 'worst first');
});

test('a mid score with nothing alarming lists no low areas', () => {
  const r = scoreAssessment(answer(3));
  assert.deepEqual(r.lowest, []);
});
