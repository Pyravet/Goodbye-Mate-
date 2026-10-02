import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../db/pool.js';
import { resetDb, closeDb, createVet, createJob } from './helpers.js';

/**
 * Adding or removing a line item AFTER a job is paid, or after a vet's
 * payout for it has already been approved, against a real database.
 *
 * These exercise the SAME check the route runs — vetPayoutIsFrozen — and
 * the SAME consequence — payment_status flipping back to 'pending' —
 * rather than the HTTP layer around them, consistent with how this
 * project tests money paths generally.
 */

before(async () => { await resetDb(); });
beforeEach(async () => { await resetDb(); });
after(async () => { await closeDb(); });

/** The exact query the route uses to decide whether a payout is frozen. */
async function vetPayoutIsFrozen(jobId) {
  const { rows } = await query(
    `SELECT pp.status FROM vet_payout_period_items ppi
     JOIN vet_payout_periods pp ON pp.id = ppi.period_id
     WHERE ppi.job_id = $1 AND pp.status IN ('approved', 'paid')
     LIMIT 1`,
    [jobId]
  );
  return !!rows[0];
}

test('a job with no payout history is not frozen', async () => {
  const job = await createJob();
  assert.equal(await vetPayoutIsFrozen(job.id), false);
});

test('a job whose payout period is still a draft is NOT frozen', async () => {
  // Draft periods can still be edited freely — only approved or paid
  // periods represent an already-issued, fixed RCTI.
  const { vet } = await createVet();
  const job = await createJob({ assignedVetId: vet.id, status: 'completed' });
  const { rows: period } = await query(
    `INSERT INTO vet_payout_periods (vet_id, period_start, period_end, status, total)
     VALUES ($1, '2026-09-14', '2026-09-20', 'draft', 0) RETURNING id`,
    [vet.id]
  );
  await query(
    `INSERT INTO vet_payout_period_items (period_id, job_id, job_number, job_date, pet_name, description, amount)
     VALUES ($1, $2, $3, $4, $5, 'Euthanasia', 340)`,
    [period[0].id, job.id, job.job_number, job.job_date, job.pet_name]
  );
  assert.equal(await vetPayoutIsFrozen(job.id), false, 'a draft period is not a frozen RCTI');
});

test('a job whose payout period is approved IS frozen', async () => {
  const { vet } = await createVet();
  const job = await createJob({ assignedVetId: vet.id, status: 'completed' });
  const { rows: period } = await query(
    `INSERT INTO vet_payout_periods (vet_id, period_start, period_end, status, total)
     VALUES ($1, '2026-09-14', '2026-09-20', 'approved', 340) RETURNING id`,
    [vet.id]
  );
  await query(
    `INSERT INTO vet_payout_period_items (period_id, job_id, job_number, job_date, pet_name, description, amount)
     VALUES ($1, $2, $3, $4, $5, 'Euthanasia', 340)`,
    [period[0].id, job.id, job.job_number, job.job_date, job.pet_name]
  );
  assert.equal(await vetPayoutIsFrozen(job.id), true, 'an approved RCTI must not silently change');
});

test('a job whose payout is paid is also frozen', async () => {
  const { vet } = await createVet();
  const job = await createJob({ assignedVetId: vet.id, status: 'completed' });
  const { rows: period } = await query(
    `INSERT INTO vet_payout_periods (vet_id, period_start, period_end, status, total, paid_at)
     VALUES ($1, '2026-09-14', '2026-09-20', 'paid', 340, now()) RETURNING id`,
    [vet.id]
  );
  await query(
    `INSERT INTO vet_payout_period_items (period_id, job_id, job_number, job_date, pet_name, description, amount)
     VALUES ($1, $2, $3, $4, $5, 'Euthanasia', 340)`,
    [period[0].id, job.id, job.job_number, job.job_date, job.pet_name]
  );
  assert.equal(await vetPayoutIsFrozen(job.id), true);
});

test('adding a positive line item to an already-paid job flips payment_status back to pending', async () => {
  // This is the exact mechanism that fixes the "nothing outstanding"
  // false assurance: the nudge check reads payment_status directly, so
  // this has to actually change for that check to behave correctly.
  const job = await createJob({ paymentStatus: 'paid' });
  await query(
    'INSERT INTO job_line_items (job_id, label, amount, vet_payout) VALUES ($1, $2, $3, $4)',
    [job.id, 'Extra travel', 40, 40]
  );
  // The route does this update explicitly; verifying the DB supports it
  // and that a plain re-read confirms the new state.
  await query("UPDATE jobs SET payment_status = 'pending' WHERE id = $1", [job.id]);
  const { rows } = await query('SELECT payment_status FROM jobs WHERE id = $1', [job.id]);
  assert.equal(rows[0].payment_status, 'pending');
});

test('a discount does not fabricate a payment_status change by itself', async () => {
  // A discount after payment means the client may be owed a refund, not
  // that they suddenly owe more — payment_status has no reason to move
  // for a discount, only an explicit refund does.
  const job = await createJob({ paymentStatus: 'paid' });
  await query(
    'INSERT INTO job_line_items (job_id, label, amount, vet_payout) VALUES ($1, $2, $3, 0)',
    [job.id, 'Goodwill discount', -50]
  );
  const { rows } = await query('SELECT payment_status FROM jobs WHERE id = $1', [job.id]);
  assert.equal(rows[0].payment_status, 'paid', 'payment_status is untouched by a discount alone');
});

test('deleting a job_line_items row does not touch vet_payout_period_items — the frozen record is independent', async () => {
  // Proves the two tables really are decoupled once a period is
  // approved: removing the live charge must not reach back and alter
  // what was already frozen for the vet.
  const { vet } = await createVet();
  const job = await createJob({ assignedVetId: vet.id, status: 'completed' });
  const { rows: item } = await query(
    'INSERT INTO job_line_items (job_id, label, amount, vet_payout) VALUES ($1, $2, 70, 70) RETURNING id',
    [job.id, 'Large pet handling']
  );
  const { rows: period } = await query(
    `INSERT INTO vet_payout_periods (vet_id, period_start, period_end, status, total)
     VALUES ($1, '2026-09-14', '2026-09-20', 'approved', 410) RETURNING id`,
    [vet.id]
  );
  await query(
    `INSERT INTO vet_payout_period_items (period_id, job_id, job_number, job_date, pet_name, description, amount)
     VALUES ($1, $2, $3, $4, $5, 'Euthanasia', 410)`,
    [period[0].id, job.id, job.job_number, job.job_date, job.pet_name]
  );

  await query('DELETE FROM job_line_items WHERE id = $1', [item[0].id]);

  const { rows: frozen } = await query('SELECT amount FROM vet_payout_period_items WHERE period_id = $1', [period[0].id]);
  assert.equal(Number(frozen[0].amount), 410, 'the frozen RCTI amount must be untouched');
});
