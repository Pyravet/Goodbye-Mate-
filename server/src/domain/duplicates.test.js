import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisePhone, duplicateScore, sortByConfidence } from './duplicates.js';

const existing = {
  client_name: 'Sarah Jones',
  client_phone: '0400 111 222',
  client_email: 'sarah@example.com',
  pet_name: 'Bella',
  job_date: '2026-09-15',
};

test('phone normalisation collapses every Australian format', () => {
  const forms = ['0400111222', '0400 111 222', '+61400111222', '+61 400 111 222', '0400-111-222'];
  const normalised = forms.map(normalisePhone);
  assert.equal(new Set(normalised).size, 1, `all forms must match: ${normalised}`);
  assert.equal(normalised[0], '400111222');
});

test('phone normalisation rejects unusable input rather than matching everything', () => {
  // An empty result must never compare equal to another empty result, or
  // two jobs with no phone would look like duplicates of each other.
  assert.equal(normalisePhone(''), '');
  assert.equal(normalisePhone(null), '');
  assert.equal(normalisePhone('123'), '', 'too short to be a phone number');

  const a = { clientPhone: '', petName: 'Max', date: '2026-09-15' };
  const b = { client_phone: '', client_name: 'X', pet_name: 'Rex', job_date: '2026-09-15' };
  assert.equal(duplicateScore(a, b).level, null, 'two blanks must not match');
});

test('HIGH: same pet, same phone, same day', () => {
  const r = duplicateScore(
    { clientName: 'Sarah Jones', clientPhone: '+61400111222', petName: 'Bella', date: '2026-09-15' },
    existing
  );
  assert.equal(r.level, 'high');
  assert.ok(r.reasons.some((x) => /phone/.test(x)));
  assert.ok(r.reasons.some((x) => /pet/.test(x)));
});

test('HIGH: matched on email when the phone was typed differently', () => {
  const r = duplicateScore(
    { clientName: 'S Jones', clientPhone: '0499 999 999', clientEmail: 'SARAH@example.com', petName: 'bella', date: '2026-09-16' },
    existing
  );
  assert.equal(r.level, 'high', 'email match plus same pet within 3 days');
});

test('MEDIUM: same pet and contact, but weeks apart', () => {
  const r = duplicateScore(
    { clientName: 'Sarah Jones', clientPhone: '0400111222', petName: 'Bella', date: '2026-10-20' },
    existing
  );
  assert.equal(r.level, 'medium', 'could be a rebooking — flag, do not treat as certain');
});

test('LOW: same client, different pet', () => {
  const r = duplicateScore(
    { clientName: 'Sarah Jones', clientPhone: '0400111222', petName: 'Rex', date: '2026-09-15' },
    existing
  );
  assert.equal(r.level, 'low', 'a second pet is a real and sad thing that happens');
});

test('no match when nothing links them', () => {
  const r = duplicateScore(
    { clientName: 'Tom Green', clientPhone: '0411222333', petName: 'Rex', date: '2026-09-15' },
    existing
  );
  assert.equal(r.level, null);
});

test('pet name matching ignores case and stray whitespace', () => {
  const r = duplicateScore(
    { clientName: 'Sarah Jones', clientPhone: '0400111222', petName: '  BELLA  ', date: '2026-09-15' },
    existing
  );
  assert.equal(r.level, 'high', 'typing "BELLA" must not defeat the check');
});

test('a booking the day BEFORE still counts as close', () => {
  // daysApart is negative here; using the raw value rather than its
  // absolute would miss duplicates booked slightly earlier.
  const r = duplicateScore(
    { clientName: 'Sarah Jones', clientPhone: '0400111222', petName: 'Bella', date: '2026-09-13' },
    existing
  );
  assert.equal(r.level, 'high');
  assert.equal(r.daysApart, -2);
});

test('sortByConfidence puts the most likely duplicate first', () => {
  const sorted = sortByConfidence([
    { level: 'low' }, { level: 'high' }, { level: 'medium' },
  ]);
  assert.deepEqual(sorted.map((m) => m.level), ['high', 'medium', 'low']);
});
