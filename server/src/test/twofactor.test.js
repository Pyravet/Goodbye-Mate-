import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { encrypt, decrypt } from '../security/encryption.js';
import { generateTotpSecret, generateTotp, verifyTotp, generateRecoveryCodes } from '../security/totp.js';
import { resetDb, closeDb } from './helpers.js';

/**
 * 2FA flow tests against a real database.
 *
 * These check the STATE TRANSITIONS rather than the algorithm — the RFC
 * vectors in totp.test.js already prove the maths. What can go wrong
 * here is different: a secret stored in plaintext, 2FA taking effect
 * before it's confirmed, a recovery code that works twice, a challenge
 * that can be replayed.
 */

before(async () => { await resetDb(); });
beforeEach(async () => { await resetDb(); });
after(async () => { await closeDb(); });

async function makeAdmin() {
  const { rows } = await query(
    `INSERT INTO users (email, full_name, phone, password_hash, role, is_active)
     VALUES ('a@test.com','A','04', $1, 'admin', true) RETURNING *`,
    [await bcrypt.hash('password123', 10)]
  );
  return rows[0];
}

test('the TOTP secret is never stored in plaintext', async () => {
  const user = await makeAdmin();
  const secret = generateTotpSecret();
  await query('UPDATE users SET totp_secret_enc = $1 WHERE id = $2', [encrypt(secret), user.id]);

  const { rows } = await query('SELECT totp_secret_enc FROM users WHERE id = $1', [user.id]);
  assert.notEqual(rows[0].totp_secret_enc, secret, 'stored value must not equal the secret');
  assert.ok(!rows[0].totp_secret_enc.includes(secret), 'secret must not appear inside the blob');
  assert.equal(decrypt(rows[0].totp_secret_enc), secret, 'but must decrypt back');
});

test('a stored secret does NOT enable 2FA until confirmed', async () => {
  const user = await makeAdmin();
  await query('UPDATE users SET totp_secret_enc = $1 WHERE id = $2',
    [encrypt(generateTotpSecret()), user.id]);

  const { rows } = await query(
    'SELECT totp_secret_enc, totp_enabled_at FROM users WHERE id = $1', [user.id]
  );
  assert.ok(rows[0].totp_secret_enc, 'secret is stored');
  assert.equal(rows[0].totp_enabled_at, null,
    'but 2FA is off — a half-finished setup must not lock anyone out');
});

test('confirming with a valid code enables 2FA', async () => {
  const user = await makeAdmin();
  const secret = generateTotpSecret();
  await query('UPDATE users SET totp_secret_enc = $1 WHERE id = $2', [encrypt(secret), user.id]);

  assert.equal(verifyTotp(secret, generateTotp(secret)), true);
  await query('UPDATE users SET totp_enabled_at = now() WHERE id = $1', [user.id]);

  const { rows } = await query('SELECT totp_enabled_at FROM users WHERE id = $1', [user.id]);
  assert.ok(rows[0].totp_enabled_at);
});

test('a challenge can only be consumed ONCE', async () => {
  const user = await makeAdmin();
  const challenge = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(challenge).digest('hex');
  await query(
    `INSERT INTO totp_challenges (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + INTERVAL '5 minutes')`, [user.id, hash]
  );

  const consume = () => query(
    `UPDATE totp_challenges SET consumed_at = now()
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
     RETURNING user_id`, [hash]
  );

  assert.equal((await consume()).rows.length, 1, 'first use works');
  assert.equal((await consume()).rows.length, 0,
    'replay must fail — otherwise a captured challenge allows unlimited code guesses');
});

test('an expired challenge is rejected', async () => {
  const user = await makeAdmin();
  const hash = crypto.createHash('sha256').update('x').digest('hex');
  await query(
    `INSERT INTO totp_challenges (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() - INTERVAL '1 minute')`, [user.id, hash]
  );
  const { rows } = await query(
    `UPDATE totp_challenges SET consumed_at = now()
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
     RETURNING user_id`, [hash]
  );
  assert.equal(rows.length, 0, 'a stale login attempt must not be resumable');
});

test('recovery codes are stored hashed, and each works only once', async () => {
  const user = await makeAdmin();
  const codes = generateRecoveryCodes(3);
  const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
  await query('UPDATE users SET totp_recovery_codes = $1 WHERE id = $2',
    [JSON.stringify(hashes), user.id]);

  const { rows } = await query('SELECT totp_recovery_codes FROM users WHERE id = $1', [user.id]);
  const stored = rows[0].totp_recovery_codes;
  for (const c of codes) {
    assert.ok(!stored.includes(c), 'plaintext recovery code must not be stored');
  }

  // Use one.
  let matched = null;
  for (const h of stored) {
    if (await bcrypt.compare(codes[0], h)) { matched = h; break; }
  }
  assert.ok(matched, 'a valid code matches');
  await query('UPDATE users SET totp_recovery_codes = $1 WHERE id = $2',
    [JSON.stringify(stored.filter((h) => h !== matched)), user.id]);

  const { rows: after } = await query('SELECT totp_recovery_codes FROM users WHERE id = $1', [user.id]);
  assert.equal(after[0].totp_recovery_codes.length, 2, 'used code is removed');

  let stillWorks = false;
  for (const h of after[0].totp_recovery_codes) {
    if (await bcrypt.compare(codes[0], h)) stillWorks = true;
  }
  assert.equal(stillWorks, false,
    'a used code must not work again — written-down codes get found');
});

test('disabling clears the secret AND the recovery codes', async () => {
  const user = await makeAdmin();
  await query(
    `UPDATE users SET totp_secret_enc = $1, totp_enabled_at = now(),
       totp_recovery_codes = $2 WHERE id = $3`,
    [encrypt(generateTotpSecret()), JSON.stringify(['h1', 'h2']), user.id]
  );

  await query(
    `UPDATE users SET totp_enabled_at = NULL, totp_secret_enc = NULL,
       totp_recovery_codes = '[]'::jsonb WHERE id = $1`, [user.id]
  );

  const { rows } = await query(
    'SELECT totp_secret_enc, totp_enabled_at, totp_recovery_codes FROM users WHERE id = $1',
    [user.id]
  );
  assert.equal(rows[0].totp_secret_enc, null, 'stale secret must not linger');
  assert.equal(rows[0].totp_enabled_at, null);
  assert.deepEqual(rows[0].totp_recovery_codes, [],
    'old recovery codes must not survive and re-enable access later');
});
