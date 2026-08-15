import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isVetAvailableAtDateTime,
  isVetAvailableOnDate,
  hasTimeConflict,
  rankVets,
  rankVetsByLocation,
} from './dispatch.js';

test('isVetAvailableAtDateTime: reads the weekly hours grid for that day/hour', () => {
  const vet = { weekly_hours: { mon: { 9: true, 10: false } } };
  // 2026-08-17 is a Monday
  assert.equal(isVetAvailableAtDateTime(vet, '2026-08-17', '09:00'), true);
  assert.equal(isVetAvailableAtDateTime(vet, '2026-08-17', '10:00'), false);
  assert.equal(isVetAvailableAtDateTime(vet, '2026-08-17', '11:00'), false); // not set = unavailable
});

test('isVetAvailableAtDateTime: a date override beats the weekly grid', () => {
  const vet = { weekly_hours: { mon: { 9: false } }, date_overrides: { '2026-08-17': true } };
  assert.equal(isVetAvailableAtDateTime(vet, '2026-08-17', '09:00'), true);
});

test('isVetAvailableOnDate: true if any hour that day is on', () => {
  const vet = { weekly_hours: { mon: { 9: false, 14: true } } };
  assert.equal(isVetAvailableOnDate(vet, '2026-08-17'), true);
});

test('hasTimeConflict: flags jobs on the same day within the 90-min buffer', () => {
  const job = { id: 'new', job_date: '2026-08-17', job_time: '10:00' };
  const other = [{ id: 'existing', job_date: '2026-08-17', job_time: '10:30' }];
  assert.equal(hasTimeConflict(job, other), true);
});

test('hasTimeConflict: no conflict outside the buffer or on a different day', () => {
  const job = { id: 'new', job_date: '2026-08-17', job_time: '10:00' };
  const farEnough = [{ id: 'a', job_date: '2026-08-17', job_time: '13:00' }];
  const differentDay = [{ id: 'b', job_date: '2026-08-18', job_time: '10:15' }];
  assert.equal(hasTimeConflict(job, farEnough), false);
  assert.equal(hasTimeConflict(job, differentDay), false);
});

test('rankVets: territory match outranks postcode match, which outranks nothing', () => {
  const job = { postcode: '3121', job_date: '2026-08-17', job_time: '10:00' };
  const vets = [
    { id: 'v1', full_name: 'In territory', territoryContainsPoint: true, postcodes: [], weekly_hours: {} },
    { id: 'v2', full_name: 'Exact postcode', territoryContainsPoint: null, postcodes: ['3121'], weekly_hours: {} },
    { id: 'v3', full_name: 'No match', territoryContainsPoint: null, postcodes: ['6000'], weekly_hours: {} },
  ];
  const ranked = rankVets(job, vets);
  assert.deepEqual(ranked.map((r) => r.vetId), ['v1', 'v2', 'v3']);
});

test('rankVets: a booking conflict drops a vet below an available one', () => {
  const job = { id: 'new', postcode: '3121', job_date: '2026-08-17', job_time: '10:00' };
  const vets = [
    {
      id: 'busy', full_name: 'Busy vet', territoryContainsPoint: true, postcodes: [], weekly_hours: {},
      otherActiveJobs: [{ id: 'x', job_date: '2026-08-17', job_time: '10:15' }],
    },
    { id: 'free', full_name: 'Free vet', territoryContainsPoint: null, postcodes: [], weekly_hours: {} },
  ];
  const ranked = rankVets(job, vets);
  assert.equal(ranked[0].vetId, 'free');
});

test('rankVetsByLocation: same territory/postcode rules, no availability scoring needed', () => {
  const vets = [
    { id: 'v1', full_name: 'Territory', territoryContainsPoint: true, postcodes: [] },
    { id: 'v2', full_name: 'Nearby', territoryContainsPoint: null, postcodes: ['3100'] },
  ];
  const ranked = rankVetsByLocation('3121', vets);
  assert.equal(ranked[0].vetId, 'v1');
  assert.equal(ranked[0].label, 'Within drawn territory');
  assert.equal(ranked[1].label, 'Nearby region');
});
