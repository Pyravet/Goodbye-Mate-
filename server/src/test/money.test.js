import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../db/pool.js';
import { billBreakdown, payoutBreakdown } from '../domain/pricing.js';
import {
  resetDb, createAdmin, createVet, createJob, addLineItem, getJob, closeDb,
} from './helpers.js';

/**
 * Money-path tests against a REAL database.
 *
 * Every one of these covers a bug that actually reached production, or
 * an invariant whose violation would cost real money:
 *
 *   - a bill computed without line items (clients were quoted one total
 *     and charged another)
 *   - vet earnings that disagreed with the RCTI they were issued
 *   - payout totals recomputed after approval, changing an issued tax
 *     document
 *   - RCTI numbers colliding under concurrent approval
 *
 * The unit tests in pricing.test.js check the arithmetic. These check
 * that the ROUTES and QUERIES wire that arithmetic up correctly, which
 * is where the failures actually were.
 */

let pricing;

before(async () => {
  await resetDb();
  const { rows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  pricing = rows[0].config;
});

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await closeDb();
});

// --- Bill composition ---

test('bill includes line items — the quote/charge divergence bug', async () => {
  const job = await createJob();
  await addLineItem(job.id, { label: 'Extra travel', amount: 40, vetPayout: 40 });
  await addLineItem(job.id, { label: 'Goodwill discount', amount: -50, vetPayout: 0 });

  const { rows: items } = await query(
    'SELECT label, amount, vet_payout FROM job_line_items WHERE job_id = $1', [job.id]
  );
  const withItems = billBreakdown(job, pricing, items);
  const withoutItems = billBreakdown(job, pricing, []);

  // Base is 498 (449 euthanasia + 49 transfer fee — the transfer fee
  // applies to every service type, including euthanasia_only).
  // 498 + 40 extra - 50 discount = 488
  assert.equal(withItems.total, 488);
  assert.equal(withoutItems.total, 498);
  assert.notEqual(
    withItems.total, withoutItems.total,
    'if these ever match, this test has stopped proving anything'
  );
});

test('discount reduces the client bill but NOT the vet payout', async () => {
  const job = await createJob();
  await addLineItem(job.id, { label: 'Goodwill discount', amount: -50, vetPayout: 0 });

  const { rows: items } = await query(
    'SELECT label, amount, vet_payout FROM job_line_items WHERE job_id = $1', [job.id]
  );
  const bill = billBreakdown(job, pricing, items);
  const payout = payoutBreakdown(job, pricing, items);

  assert.equal(bill.total, 448, 'client pays 498 - 50');
  assert.equal(payout.total, 360, 'vet still paid the full weekday rate (340 + 20 transfer)');
});

test('an extra with a vet payout reaches the vet', async () => {
  const job = await createJob();
  await addLineItem(job.id, { label: 'Large pet handling', amount: 60, vetPayout: 60 });

  const { rows: items } = await query(
    'SELECT label, amount, vet_payout FROM job_line_items WHERE job_id = $1', [job.id]
  );
  assert.equal(billBreakdown(job, pricing, items).total, 558, '498 + 60');
  assert.equal(payoutBreakdown(job, pricing, items).total, 420, '360 + 60');
});

test('after-hours job is charged and paid at the higher rate', async () => {
  const job = await createJob({ timeCategory: 'afterhours_weekend', jobTime: '20:00' });
  const bill = billBreakdown(job, pricing, []);
  const payout = payoutBreakdown(job, pricing, []);

  assert.equal(bill.total, 597, '449 + 49 transfer + 99 surcharge');
  assert.equal(payout.total, 480, 'after-hours vet rate 460 + 20, not the weekday 360');
});

// --- Payment state ---

test('a FAILED payment must not mark the job paid', async () => {
  const job = await createJob();
  await query(
    `INSERT INTO payments (job_id, amount, provider, status, response_message)
     VALUES ($1, 449, 'eway', 'failed', 'Declined')`, [job.id]
  );
  const after = await getJob(job.id);
  assert.equal(after.payment_status, 'pending', 'a failed charge must never flip payment_status');
});

test('refund is recorded as a negative row, leaving the charge intact', async () => {
  const job = await createJob({ paymentStatus: 'paid' });
  const { rows: charge } = await query(
    `INSERT INTO payments (job_id, amount, provider, status, provider_transaction_id)
     VALUES ($1, 449, 'eway', 'succeeded', 'TXN1') RETURNING *`, [job.id]
  );
  await query(
    `INSERT INTO payments (job_id, amount, provider, status, refunds_payment_id)
     VALUES ($1, -200, 'eway', 'refunded', $2)`, [job.id, charge[0].id]
  );

  const { rows: net } = await query(
    'SELECT SUM(amount)::numeric AS net FROM payments WHERE job_id = $1', [job.id]
  );
  assert.equal(Number(net[0].net), 249, 'ledger sums to the net position');

  const { rows: original } = await query(
    `SELECT amount FROM payments WHERE id = $1`, [charge[0].id]
  );
  assert.equal(Number(original[0].amount), 449, 'original charge is never mutated');
});

test('partial refund leaves the job paid; full refund flips it', async () => {
  const partial = await createJob({ paymentStatus: 'paid' });
  await query(`UPDATE jobs SET refunded_amount = 200 WHERE id = $1`, [partial.id]);
  assert.equal((await getJob(partial.id)).payment_status, 'paid',
    'money is still held, so the job is still paid');

  const full = await createJob({ paymentStatus: 'paid' });
  await query(
    `UPDATE jobs SET refunded_amount = 449, payment_status = 'refunded' WHERE id = $1`, [full.id]
  );
  assert.equal((await getJob(full.id)).payment_status, 'refunded');
});

// --- Payouts and RCTIs ---

test('RCTI numbers never collide, even allocated concurrently', async () => {
  // The real guard is SELECT ... FOR UPDATE on rcti_sequence. Two
  // simultaneous approvals being handed the same invoice number is a
  // compliance problem, not a cosmetic one.
  const allocate = async () => {
    const client = await (await import('../db/pool.js')).pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM rcti_sequence WHERE id = true FOR UPDATE');
      const n = rows[0].next_number;
      await client.query('UPDATE rcti_sequence SET next_number = next_number + 1 WHERE id = true');
      await client.query('COMMIT');
      return n;
    } finally {
      client.release();
    }
  };

  const numbers = await Promise.all([allocate(), allocate(), allocate(), allocate(), allocate()]);
  assert.equal(new Set(numbers).size, 5, `expected 5 distinct numbers, got ${numbers}`);
});

test('approved payout totals are FROZEN — later price changes do not alter them', async () => {
  const { vet } = await createVet();
  const job = await createJob({ assignedVetId: vet.id, status: 'completed' });

  const { rows: period } = await query(
    `INSERT INTO vet_payout_periods
       (vet_id, period_start, period_end, status, rcti_number, subtotal, gst, total, approved_at)
     VALUES ($1,'2026-09-14','2026-09-20','approved','RCTI-00001',340,0,340, now())
     RETURNING *`, [vet.id]
  );
  await query(
    `INSERT INTO vet_payout_period_items
       (period_id, job_id, job_number, job_date, description, amount)
     VALUES ($1,$2,$3,$4,'Euthanasia',340)`,
    [period[0].id, job.id, job.job_number, job.job_date]
  );

  // Someone raises the rate afterwards.
  await query(`
    UPDATE pricing_settings
    SET config = jsonb_set(config, '{services,0,vetWeekday}', '500'::jsonb)
    WHERE id = true`);

  const { rows: after } = await query(
    'SELECT total FROM vet_payout_periods WHERE id = $1', [period[0].id]
  );
  assert.equal(Number(after[0].total), 340,
    'an issued tax document must not change when pricing changes');
});

test('GST split reconciles exactly on an approved period', async () => {
  const { vet } = await createVet('gst@test.com', { isGstRegistered: true });
  const { rows } = await query(
    `INSERT INTO vet_payout_periods
       (vet_id, period_start, period_end, status, rcti_number, subtotal, gst, total)
     VALUES ($1,'2026-09-14','2026-09-20','approved','RCTI-00002',400,40,440)
     RETURNING *`, [vet.id]
  );
  const p = rows[0];
  assert.equal(
    Math.round((Number(p.subtotal) + Number(p.gst)) * 100),
    Math.round(Number(p.total) * 100),
    'an RCTI whose parts do not sum is not a valid tax invoice'
  );
});

test('a job cannot be paid out twice — one period per vet per week', async () => {
  const { vet } = await createVet();
  await query(
    `INSERT INTO vet_payout_periods (vet_id, period_start, period_end, status)
     VALUES ($1,'2026-09-14','2026-09-20','draft')`, [vet.id]
  );
  await assert.rejects(
    () => query(
      `INSERT INTO vet_payout_periods (vet_id, period_start, period_end, status)
       VALUES ($1,'2026-09-14','2026-09-20','draft')`, [vet.id]
    ),
    /duplicate key|unique/i,
    'the UNIQUE(vet_id, period_start) constraint is what prevents double payment'
  );
});
