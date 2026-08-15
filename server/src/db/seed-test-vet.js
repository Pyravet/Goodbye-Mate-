import bcrypt from 'bcryptjs';
import { pool, query } from './pool.js';

// A fixed, always-available vet login for testing the vet PWA/native app —
// safe to run on every startup since it only creates the account once
// (checked by email) and never overwrites it on subsequent runs. is_active
// is true from the start so it can log in immediately with no approval step.
const TEST_VET_EMAIL = 'test.vet@goodbyemate.com.au';
const TEST_VET_PASSWORD = 'TestVet123!';

export async function seedTestVet() {
  const { rows: existing } = await query('SELECT id FROM users WHERE email = $1', [TEST_VET_EMAIL]);
  if (existing[0]) return; // already seeded, nothing to do

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const passwordHash = await bcrypt.hash(TEST_VET_PASSWORD, 12);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (email, password_hash, role, full_name, phone, is_active)
       VALUES ($1,$2,'vet','Test Vet','0400000000',true) RETURNING id`,
      [TEST_VET_EMAIL, passwordHash]
    );
    const userId = userRows[0].id;

    await client.query(
      `INSERT INTO vets (user_id, reg_number, reg_state, postcodes, color)
       VALUES ($1,'TEST123','VIC',$2,'#4A6B5A')`,
      [userId, ['3000', '3121', '3141', '3181']]
    );

    await client.query('COMMIT');
    console.log(`Seeded test vet account: ${TEST_VET_EMAIL}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to seed test vet:', err.message);
  } finally {
    client.release();
  }
}
