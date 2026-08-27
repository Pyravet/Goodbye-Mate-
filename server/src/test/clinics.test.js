import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { resetDb, closeDb } from './helpers.js';

/**
 * Clinic isolation, against a real database.
 *
 * One clinic seeing another's referrals would expose a competitor's
 * client list. That was verified by hand when the portal was built but
 * had no test protecting it — so a later change to the query could break
 * it silently, and nothing would fail.
 *
 * These exercise the SAME queries the routes run, scoped the way the
 * routes scope them: by clinic id resolved from the session user, never
 * from anything the caller supplies.
 */

before(async () => { await resetDb(); });
beforeEach(async () => {
  await resetDb();
  await query('TRUNCATE TABLE clinics CASCADE');
});
after(async () => { await closeDb(); });

async function makeClinic(name) {
  const { rows } = await query('INSERT INTO clinics (name) VALUES ($1) RETURNING *', [name]);
  return rows[0];
}

async function makeClinicUser(email, clinicId) {
  const { rows } = await query(
    `INSERT INTO users (email, full_name, password_hash, role, is_active)
     VALUES ($1, 'Clinic User', $2, 'clinic', true) RETURNING *`,
    [email, await bcrypt.hash('x'.repeat(12), 4)]
  );
  await query('INSERT INTO clinic_users (user_id, clinic_id) VALUES ($1, $2)', [rows[0].id, clinicId]);
  return rows[0];
}

async function makeReferral(clinicId, clientName) {
  const { rows } = await query(
    `INSERT INTO booking_requests (client_name, client_phone, pet_name, referred_by_clinic_id, status)
     VALUES ($1, '0400000000', 'Pet', $2, 'new') RETURNING *`,
    [clientName, clinicId]
  );
  return rows[0];
}

/** Exactly what GET /clinics/referrals does: resolve, then scope. */
async function referralsVisibleTo(userId) {
  const { rows: link } = await query('SELECT clinic_id FROM clinic_users WHERE user_id = $1', [userId]);
  if (!link[0]) return null;
  const { rows } = await query(
    'SELECT client_name FROM booking_requests WHERE referred_by_clinic_id = $1',
    [link[0].clinic_id]
  );
  return rows.map((r) => r.client_name);
}

test('a clinic sees only its own referrals', async () => {
  const a = await makeClinic('Clinic A');
  const b = await makeClinic('Clinic B');
  const userA = await makeClinicUser('a@clinic.test', a.id);

  await makeReferral(a.id, 'Client of A');
  await makeReferral(b.id, 'Client of B');

  const seen = await referralsVisibleTo(userA.id);
  assert.deepEqual(seen, ['Client of A']);
  assert.ok(!seen.includes('Client of B'), "a competitor's client list must never be visible");
});

test('a clinic login not linked to a clinic sees nothing, rather than everything', async () => {
  // The dangerous failure: an unlinked user resolving to null and a
  // query then running unscoped. Must fail closed.
  const a = await makeClinic('Clinic A');
  await makeReferral(a.id, 'Client of A');

  const { rows } = await query(
    `INSERT INTO users (email, full_name, password_hash, role, is_active)
     VALUES ('orphan@clinic.test', 'Orphan', 'x', 'clinic', true) RETURNING *`
  );
  assert.equal(await referralsVisibleTo(rows[0].id), null, 'no clinic link means no data');
});

test('two logins at the same clinic see the same referrals', async () => {
  // A practice manager and a head nurse both submitting is normal.
  const a = await makeClinic('Clinic A');
  const one = await makeClinicUser('one@clinic.test', a.id);
  const two = await makeClinicUser('two@clinic.test', a.id);
  await makeReferral(a.id, 'Shared Client');

  assert.deepEqual(await referralsVisibleTo(one.id), ['Shared Client']);
  assert.deepEqual(await referralsVisibleTo(two.id), ['Shared Client']);
});

test('attribution carries from the referral onto the job', async () => {
  // Without this the portal could show a referral but never that it
  // became a completed visit — the only outcome a clinic cares about.
  const a = await makeClinic('Clinic A');
  const referral = await makeReferral(a.id, 'Client of A');

  const { rows: jobRows } = await query(
    `INSERT INTO jobs (client_name, client_phone, address, postcode, state, pet_name, pet_type,
       service_id, service_type, job_date, job_time, time_category, referred_by_clinic_id)
     VALUES ('Client of A','0400000000','1 St','2300','NSW','Pet','Dog','svc_euth',
       'euthanasia_only','2026-09-15','13:00','weekday',$1) RETURNING *`,
    [referral.referred_by_clinic_id]
  );
  await query('UPDATE booking_requests SET converted_job_id = $1 WHERE id = $2',
    [jobRows[0].id, referral.id]);

  const { rows } = await query(
    `SELECT j.job_number, j.status FROM booking_requests r
     JOIN jobs j ON j.id = r.converted_job_id
     WHERE r.referred_by_clinic_id = $1`,
    [a.id]
  );
  assert.equal(rows.length, 1, 'the clinic can see their referral became a job');
  assert.ok(rows[0].job_number);
});

test('deactivating a clinic keeps its referrals attributed', async () => {
  // A clinic that leaves still explains where past jobs came from.
  const a = await makeClinic('Clinic A');
  await makeReferral(a.id, 'Client of A');
  await query('UPDATE clinics SET is_active = false WHERE id = $1', [a.id]);

  const { rows } = await query(
    'SELECT count(*)::int AS c FROM booking_requests WHERE referred_by_clinic_id = $1', [a.id]
  );
  assert.equal(rows[0].c, 1, 'attribution must survive deactivation');
});

test('deleting a clinic does NOT delete the referral record', async () => {
  // ON DELETE SET NULL, not CASCADE. Removing a partner must not erase
  // the enquiry or the job it became.
  const a = await makeClinic('Clinic A');
  await makeReferral(a.id, 'Client of A');
  await query('DELETE FROM clinics WHERE id = $1', [a.id]);

  const { rows } = await query(
    "SELECT referred_by_clinic_id FROM booking_requests WHERE client_name = 'Client of A'"
  );
  assert.equal(rows.length, 1, 'the referral itself must survive');
  assert.equal(rows[0].referred_by_clinic_id, null, 'attribution is cleared, not cascaded');
});

test('the clinic role is accepted by the users table', async () => {
  // role moved from an enum to a TEXT column with a CHECK, since
  // ALTER TYPE ADD VALUE cannot run inside a transaction.
  const { rows } = await query(
    `INSERT INTO users (email, full_name, password_hash, role, is_active)
     VALUES ('role@test.com','R','x','clinic',true) RETURNING role`
  );
  assert.equal(rows[0].role, 'clinic');

  await assert.rejects(
    () => query(
      `INSERT INTO users (email, full_name, password_hash, role, is_active)
       VALUES ('bad@test.com','B','x','superuser',true)`
    ),
    /check constraint|violates/i,
    'the CHECK must still reject an unknown role'
  );
});
