import { query, pool } from '../db/pool.js';
import { signAccessToken } from '../auth/tokens.js';

/**
 * Helpers for route-level tests that run against a REAL Postgres.
 *
 * Why a real database rather than mocks: every money bug this project has
 * had was in the SQL or in how the route wired data together — a
 * mismatched placeholder count, a bill computed without line items, a
 * status guard that didn't guard. Mocking the database would have let
 * all of them through, because the mock would have returned whatever the
 * test author assumed. These tests are only worth writing if they
 * exercise the actual queries.
 *
 * Requires DATABASE_URL pointing at a THROWAWAY database — resetDb()
 * truncates every table.
 */

/** Wipe all data but keep the schema. */
export async function resetDb() {
  // Truncate rather than drop/recreate: far faster between tests, and
  // CASCADE handles the foreign keys without needing a correct order.
  await query(`
    TRUNCATE TABLE
      jobs, users, vets, payments, job_line_items, job_reviews,
      vet_payout_periods, vet_payout_period_items, vet_job_offers,
      vet_job_dropouts, notifications, audit_log, booking_requests,
      conversations, conversation_participants, conversation_messages,
      job_medical_notes, refresh_tokens
    RESTART IDENTITY CASCADE
  `);
  // Settings are configuration, not test data. UPSERT rather than
  // UPDATE: the row must EXIST, and an UPDATE silently does nothing if
  // it doesn't — which is exactly how these tests first failed, with a
  // confusing "cannot read config of undefined" three layers away.
  await query(`
    INSERT INTO pricing_settings (id, config) VALUES (true, '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);
  await query(`
    INSERT INTO content_settings (id, config) VALUES (true, '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);
  await query(`
    INSERT INTO rcti_sequence (id) VALUES (true) ON CONFLICT (id) DO NOTHING
  `);
  await query(`
    UPDATE pricing_settings SET config = jsonb_build_object(
      'services', jsonb_build_array(jsonb_build_object(
        'id','svc_euth','name','Euthanasia',
        'clientPrice',449,'vetWeekday',340,'vetAfterhours',460)),
      'transferFee', jsonb_build_object('clientPrice',49,'vetWeekday',20,'vetAfterhours',20),
      'afterHoursSurcharge',99, 'communalCremationFee',190,
      'gstPercent',10, 'isGstRegistered', false
    ) WHERE id = true
  `);
  await query(`UPDATE rcti_sequence SET next_number = 1 WHERE id = true`);
}

export async function createAdmin(email = 'admin@test.com') {
  const { rows } = await query(
    `INSERT INTO users (email, full_name, phone, password_hash, role, is_active)
     VALUES ($1, 'Test Admin', '0400000000', 'x', 'admin', true) RETURNING *`,
    [email]
  );
  return { user: rows[0], token: signAccessToken(rows[0]) };
}

export async function createVet(email = 'vet@test.com', overrides = {}) {
  const { rows: userRows } = await query(
    `INSERT INTO users (email, full_name, phone, password_hash, role, is_active)
     VALUES ($1, $2, '0400111222', 'x', 'vet', true) RETURNING *`,
    [email, overrides.fullName || 'Test Vet']
  );
  const { rows: vetRows } = await query(
    `INSERT INTO vets (user_id, is_gst_registered, postcodes)
     VALUES ($1, $2, '{2300}') RETURNING *`,
    [userRows[0].id, overrides.isGstRegistered ?? false]
  );
  return { user: userRows[0], vet: vetRows[0], token: signAccessToken(userRows[0]) };
}

/**
 * Create a job. Defaults produce a straightforward weekday euthanasia so
 * each test only has to state what it actually cares about.
 */
export async function createJob(overrides = {}) {
  const d = {
    clientName: 'Test Client',
    clientPhone: '0400333444',
    clientEmail: 'client@test.com',
    address: '1 Test St',
    suburb: 'Newcastle',
    postcode: '2300',
    state: 'NSW',
    petName: 'Bella',
    petType: 'Dog',
    serviceType: 'euthanasia_only',
    jobDate: '2026-09-15',      // a Tuesday
    jobTime: '13:00',
    timeCategory: 'weekday',
    ...overrides,
  };
  const { rows } = await query(
    `INSERT INTO jobs (
       client_name, client_phone, client_email, address, suburb, postcode, state,
       pet_name, pet_type, service_id, service_type, job_date, job_time,
       time_category, assigned_vet_id, status, payment_status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'svc_euth',$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      d.clientName, d.clientPhone, d.clientEmail, d.address, d.suburb, d.postcode, d.state,
      d.petName, d.petType, d.serviceType, d.jobDate, d.jobTime, d.timeCategory,
      d.assignedVetId ?? null, d.status || 'available', d.paymentStatus || 'pending',
    ]
  );
  return rows[0];
}

export async function addLineItem(jobId, { label, amount, vetPayout = 0 }) {
  const { rows } = await query(
    `INSERT INTO job_line_items (job_id, label, amount, vet_payout)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [jobId, label, amount, vetPayout]
  );
  return rows[0];
}

export async function getJob(id) {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [id]);
  return rows[0];
}

export async function closeDb() {
  await pool.end();
}
