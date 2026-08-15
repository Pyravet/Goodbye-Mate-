import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Encryption requires a key from the environment — set one for this test
// run only, so the test doesn't depend on real deployment secrets.
before(() => {
  process.env.BANK_DETAILS_ENC_KEY = crypto.randomBytes(32).toString('base64');
});

const { encrypt, decrypt, isEncryptionConfigured, maskTail } = await import('./encryption.js');

test('encrypt/decrypt: round-trips a value correctly', () => {
  const encrypted = encrypt('123456789');
  assert.notEqual(encrypted, '123456789'); // actually encrypted, not passthrough
  assert.equal(decrypt(encrypted), '123456789');
});

test('encrypt: null/empty input returns null instead of encrypting nothing', () => {
  assert.equal(encrypt(null), null);
  assert.equal(encrypt(''), null);
});

test('isEncryptionConfigured: true once the key is set', () => {
  assert.equal(isEncryptionConfigured(), true);
});

test('maskTail: hides everything except the last few characters', () => {
  assert.equal(maskTail('12345678', 3), '•••••678');
  assert.equal(maskTail('12', 3), '••'); // shorter than visibleChars — mask it all
});
