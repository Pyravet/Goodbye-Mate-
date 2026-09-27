import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../db/pool.js';
import { resetDb, closeDb } from './helpers.js';

/**
 * The extra services catalog: reusable priced add-ons an admin defines
 * once and applies to jobs, instead of retyping a label, charge and vet
 * payout by hand each time.
 *
 * These exercise the SAME queries the routes run.
 */

before(async () => { await resetDb(); });
beforeEach(async () => {
  await resetDb();
  await query('TRUNCATE TABLE extra_services CASCADE');
});
after(async () => { await closeDb(); });

async function createService({ name, clientPrice, vetPayout = 0 }) {
  const { rows: maxRow } = await query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM extra_services');
  const { rows } = await query(
    `INSERT INTO extra_services (name, client_price, vet_payout, sort_order)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, clientPrice, vetPayout, maxRow[0].next]
  );
  return rows[0];
}

test('a new service is active and appears in the default list', async () => {
  await createService({ name: 'Paw print keepsake', clientPrice: 35 });
  const { rows } = await query('SELECT name FROM extra_services WHERE is_active = true');
  assert.deepEqual(rows.map((r) => r.name), ['Paw print keepsake']);
});

test('retiring hides it from the active list but keeps the row', async () => {
  // A DELETE would risk taking the row out from under any job that
  // referenced it; this is retire, not delete, precisely so historical
  // charges keep meaning something.
  const svc = await createService({ name: 'Certificate', clientPrice: 15 });
  await query('UPDATE extra_services SET is_active = false WHERE id = $1', [svc.id]);

  const { rows: active } = await query('SELECT name FROM extra_services WHERE is_active = true');
  assert.deepEqual(active, []);

  const { rows: all } = await query('SELECT name, is_active FROM extra_services WHERE id = $1', [svc.id]);
  assert.equal(all[0].name, 'Certificate');
  assert.equal(all[0].is_active, false);
});

test('negative prices are rejected by the column constraint', async () => {
  await assert.rejects(
    query('INSERT INTO extra_services (name, client_price, sort_order) VALUES ($1, $2, 0)',
      ['Bad service', -10]),
    /violates check constraint/
  );
});

test('a zero vet payout is valid — an office-only add-on', async () => {
  // Not every add-on passes through to the vet; a keepsake made after
  // the visit is a common example. Zero must not be rejected as
  // "missing".
  const svc = await createService({ name: 'Keepsake', clientPrice: 40, vetPayout: 0 });
  assert.equal(Number(svc.vet_payout), 0);
});

test('editing a service does not alter jobs that already used it', async () => {
  // Applying a service copies its numbers onto a job_line_items row at
  // that moment — the two tables are deliberately independent after
  // that point, the same as every other price in this app.
  const svc = await createService({ name: 'Home visit fee', clientPrice: 50, vetPayout: 40 });

  const { rows: job } = await query(`INSERT INTO jobs
    (client_name, client_phone, address, postcode, state, pet_name, pet_type, service_id,
     service_type, job_date, job_time, time_category)
    VALUES ('Test', '0400000000', '1 St', '2300', 'NSW', 'Rex', 'Dog', 'svc_euth',
     'euthanasia_only', '2026-09-15', '13:00', 'weekday') RETURNING id`);
  await query(
    'INSERT INTO job_line_items (job_id, label, amount, vet_payout) VALUES ($1, $2, $3, $4)',
    [job[0].id, svc.name, svc.client_price, svc.vet_payout]
  );

  // The price changes going forward...
  await query('UPDATE extra_services SET client_price = 999 WHERE id = $1', [svc.id]);

  // ...but the job's own line item is untouched.
  const { rows: line } = await query('SELECT amount FROM job_line_items WHERE job_id = $1', [job[0].id]);
  assert.equal(Number(line[0].amount), 50);
});

test('sort order is assigned incrementally, not left to collide', async () => {
  const a = await createService({ name: 'A', clientPrice: 10 });
  const b = await createService({ name: 'B', clientPrice: 10 });
  const c = await createService({ name: 'C', clientPrice: 10 });
  assert.equal(a.sort_order, 0);
  assert.equal(b.sort_order, 1);
  assert.equal(c.sort_order, 2);
});
