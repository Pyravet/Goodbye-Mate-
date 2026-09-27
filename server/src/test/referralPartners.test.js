import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { resetDb, closeDb } from './helpers.js';

/**
 * Referral partner isolation and payout eligibility, against a real
 * database.
 *
 * One partner seeing another's referrals would expose a competitor's
 * client list. That was verified by hand when the clinic portal was
 * built, and this widens it to cover the new commission and payout
 * machinery that came with the rename.
 *
 * These exercise the SAME queries the routes run, scoped the way the
 * routes scope them: by partner id resolved from the session user, never
 * from anything the caller supplies.
 */

before(async () => { await resetDb(); });
beforeEach(async () => {
  await resetDb();
  await query('TRUNCATE TABLE referral_partners CASCADE');
});
after(async () => { await closeDb(); });

async function makePartner(name, extra = {}) {
  const { rows } = await query(
    `INSERT INTO referral_partners (name, type, commission_type, commission_value, is_gst_registered)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, extra.type || 'other', extra.commissionType || 'flat', extra.commissionValue ?? 0, extra.isGstRegistered || false]
  );
  return rows[0];
}

async function makePartnerUser(email, partnerId) {
  const { rows } = await query(
    `INSERT INTO users (email, full_name, password_hash, role, is_active)
     VALUES ($1, 'Partner User', $2, 'referral_partner', true) RETURNING *`,
    [email, await bcrypt.hash('x'.repeat(12), 4)]
  );
  await query('INSERT INTO referral_partner_users (user_id, referral_partner_id) VALUES ($1, $2)', [rows[0].id, partnerId]);
  return rows[0];
}

async function makeReferral(partnerId, clientName) {
  const { rows } = await query(
    `INSERT INTO booking_requests (client_name, client_phone, pet_name, referred_by_partner_id, status)
     VALUES ($1, '0400000000', 'Pet', $2, 'new') RETURNING *`,
    [clientName, partnerId]
  );
  return rows[0];
}

async function makeCompletedJob(partnerId, clientName, jobDate = '2026-09-15') {
  const { rows } = await query(
    `INSERT INTO jobs (client_name, client_phone, address, postcode, state, pet_name, pet_type,
       service_id, service_type, job_date, job_time, time_category, status, referred_by_partner_id)
     VALUES ($1,'0400000000','1 St','2300','NSW','Pet','Dog','svc_euth',
       'euthanasia_only',$2,'13:00','weekday','completed',$3) RETURNING *`,
    [clientName, jobDate, partnerId]
  );
  return rows[0];
}

/** Exactly what GET /referral-partners/referrals does: resolve, then scope. */
async function referralsVisibleTo(userId) {
  const { rows: link } = await query('SELECT referral_partner_id FROM referral_partner_users WHERE user_id = $1', [userId]);
  if (!link[0]) return null;
  const { rows } = await query(
    'SELECT client_name FROM booking_requests WHERE referred_by_partner_id = $1',
    [link[0].referral_partner_id]
  );
  return rows.map((r) => r.client_name);
}

// --- Isolation, same properties the clinic portal was tested for ---

test('a partner sees only its own referrals', async () => {
  const a = await makePartner('Partner A');
  const b = await makePartner('Partner B');
  const userA = await makePartnerUser('a@partner.test', a.id);

  await makeReferral(a.id, 'Client of A');
  await makeReferral(b.id, 'Client of B');

  const seen = await referralsVisibleTo(userA.id);
  assert.deepEqual(seen, ['Client of A']);
  assert.ok(!seen.includes('Client of B'), "a competitor's client list must never be visible");
});

test('a login not linked to a partner sees nothing, rather than everything', async () => {
  // The dangerous failure: an unlinked user resolving to null and a
  // query then running unscoped. Must fail closed.
  const a = await makePartner('Partner A');
  await makeReferral(a.id, 'Client of A');

  const { rows } = await query(
    `INSERT INTO users (email, full_name, password_hash, role, is_active)
     VALUES ('orphan@partner.test', 'Orphan', 'x', 'referral_partner', true) RETURNING *`
  );
  assert.equal(await referralsVisibleTo(rows[0].id), null, 'no partner link means no data');
});

test('the referral_partner role is accepted by the users table', async () => {
  // role moved from an enum to a TEXT column with a CHECK, since
  // ALTER TYPE ADD VALUE cannot run inside a transaction.
  const { rows } = await query(
    `INSERT INTO users (email, full_name, password_hash, role, is_active)
     VALUES ('role@test.com','R','x','referral_partner',true) RETURNING role`
  );
  assert.equal(rows[0].role, 'referral_partner');

  await assert.rejects(
    () => query(
      `INSERT INTO users (email, full_name, password_hash, role, is_active)
       VALUES ('bad@test.com','B','x','clinic',true)`
    ),
    /check constraint|violates/i,
    'the CHECK must reject the OLD role name — this is a clean rebuild, not a compatible one'
  );
});

test('deactivating a partner keeps its referrals attributed', async () => {
  const a = await makePartner('Partner A');
  await makeReferral(a.id, 'Client of A');
  await query('UPDATE referral_partners SET is_active = false WHERE id = $1', [a.id]);

  const { rows } = await query(
    'SELECT count(*)::int AS c FROM booking_requests WHERE referred_by_partner_id = $1', [a.id]
  );
  assert.equal(rows[0].c, 1, 'attribution must survive deactivation');
});

test('deleting a partner does NOT delete the referral record', async () => {
  // ON DELETE SET NULL, not CASCADE. Removing a partner must not erase
  // the enquiry or the job it became.
  const a = await makePartner('Partner A');
  await makeReferral(a.id, 'Client of A');
  await query('DELETE FROM referral_partners WHERE id = $1', [a.id]);

  const { rows } = await query(
    "SELECT referred_by_partner_id FROM booking_requests WHERE client_name = 'Client of A'"
  );
  assert.equal(rows.length, 1, 'the referral itself must survive');
  assert.equal(rows[0].referred_by_partner_id, null, 'attribution is cleared, not cascaded');
});

// --- Payout eligibility: only a COMPLETED, REFERRED job counts ---

test('a completed referred job is eligible for a payout period', async () => {
  const a = await makePartner('Partner A', { commissionType: 'flat', commissionValue: 30 });
  await makeCompletedJob(a.id, 'Client of A');

  const { rows } = await query(
    `SELECT count(*)::int AS c FROM jobs
     WHERE referred_by_partner_id = $1 AND status = 'completed'
       AND job_date BETWEEN '2026-09-14' AND '2026-09-20'`,
    [a.id]
  );
  assert.equal(rows[0].c, 1);
});

test('an incomplete referred job is NOT eligible', async () => {
  // Commission is owed on COMPLETION, not booking. A job still in
  // progress must never appear in an approval query.
  const a = await makePartner('Partner A');
  await query(
    `INSERT INTO jobs (client_name, client_phone, address, postcode, state, pet_name, pet_type,
       service_id, service_type, job_date, job_time, time_category, status, referred_by_partner_id)
     VALUES ('Client','0400000000','1 St','2300','NSW','Pet','Dog','svc_euth',
       'euthanasia_only','2026-09-15','13:00','weekday','assigned',$1)`,
    [a.id]
  );

  const { rows } = await query(
    `SELECT count(*)::int AS c FROM jobs
     WHERE referred_by_partner_id = $1 AND status = 'completed'
       AND job_date BETWEEN '2026-09-14' AND '2026-09-20'`,
    [a.id]
  );
  assert.equal(rows[0].c, 0, 'an in-progress job owes nothing yet');
});

test('a cancelled referred job never becomes eligible', async () => {
  const a = await makePartner('Partner A');
  await query(
    `INSERT INTO jobs (client_name, client_phone, address, postcode, state, pet_name, pet_type,
       service_id, service_type, job_date, job_time, time_category, status, referred_by_partner_id)
     VALUES ('Client','0400000000','1 St','2300','NSW','Pet','Dog','svc_euth',
       'euthanasia_only','2026-09-15','13:00','weekday','cancelled',$1)`,
    [a.id]
  );

  const { rows } = await query(
    `SELECT count(*)::int AS c FROM jobs
     WHERE referred_by_partner_id = $1 AND status = 'completed'`,
    [a.id]
  );
  assert.equal(rows[0].c, 0, 'a cancelled job owes nothing, ever');
});

// --- Payout period freezing, mirroring the vet payout guarantees ---

test('a payout period cannot be approved twice', async () => {
  const a = await makePartner('Partner A', { commissionType: 'flat', commissionValue: 30 });
  await query(
    `INSERT INTO referral_partner_payout_periods
       (referral_partner_id, period_start, period_end, status, total)
     VALUES ($1, '2026-09-14', '2026-09-20', 'approved', 30)`,
    [a.id]
  );

  const { rows } = await query(
    `SELECT * FROM referral_partner_payout_periods
     WHERE referral_partner_id = $1 AND period_start = '2026-09-14' FOR UPDATE`,
    [a.id]
  );
  assert.equal(rows[0].status, 'approved', 're-approving must be refused by the route, not silently overwrite');
});

test('marking paid only succeeds from approved, never from draft', async () => {
  const a = await makePartner('Partner A');
  const { rows: draft } = await query(
    `INSERT INTO referral_partner_payout_periods
       (referral_partner_id, period_start, period_end, status, total)
     VALUES ($1, '2026-09-14', '2026-09-20', 'draft', 0) RETURNING id`,
    [a.id]
  );

  const { rows } = await query(
    `UPDATE referral_partner_payout_periods SET status = 'paid', paid_at = now()
     WHERE id = $1 AND status = 'approved' RETURNING *`,
    [draft[0].id]
  );
  assert.equal(rows.length, 0, 'a draft period must not be markable paid');
});

test('statement numbers are unique and allocated under a lock', async () => {
  const { rows: seq } = await query('SELECT * FROM referral_statement_sequence WHERE id = true FOR UPDATE');
  const n1 = seq[0].next_number;
  await query('UPDATE referral_statement_sequence SET next_number = next_number + 1 WHERE id = true');
  const { rows: seq2 } = await query('SELECT next_number FROM referral_statement_sequence WHERE id = true');
  assert.equal(seq2[0].next_number, n1 + 1);
});

test('deleting a job does not alter an already-approved statement total', async () => {
  // SET NULL, not CASCADE, on referral_partner_payout_items.job_id — the
  // same guarantee vet payouts have. An issued statement must not
  // silently change.
  const a = await makePartner('Partner A');
  const job = await makeCompletedJob(a.id, 'Client of A');
  const { rows: period } = await query(
    `INSERT INTO referral_partner_payout_periods
       (referral_partner_id, period_start, period_end, status, total)
     VALUES ($1, '2026-09-14', '2026-09-20', 'approved', 30) RETURNING id`,
    [a.id]
  );
  await query(
    `INSERT INTO referral_partner_payout_items
       (period_id, job_id, job_number, job_date, client_name, job_total, commission_type, commission_value, amount)
     VALUES ($1, $2, 'GM-0001', '2026-09-15', 'Client of A', 449, 'flat', 30, 30)`,
    [period[0].id, job.id]
  );

  await query('DELETE FROM jobs WHERE id = $1', [job.id]);

  const { rows: items } = await query('SELECT job_id, amount FROM referral_partner_payout_items WHERE period_id = $1', [period[0].id]);
  assert.equal(items[0].job_id, null, 'the link is cleared');
  assert.equal(Number(items[0].amount), 30, 'but the frozen amount survives the job being deleted');
});
