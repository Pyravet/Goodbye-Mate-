import crypto from 'node:crypto';

// Bank details are sensitive enough to encrypt at the application layer,
// not just rely on "the database is access-controlled". Uses AES-256-GCM
// (authenticated — tampering is detected, not just confidentiality).
//
// Requires BANK_DETAILS_ENC_KEY: a 32-byte key, base64-encoded, e.g.
// generated with `openssl rand -base64 32`. Deliberately does NOT fall
// back to a default key — bank details silently encrypted with a
// guessable key would be worse than a clear error telling you to set one.

function getKey() {
  const b64 = process.env.BANK_DETAILS_ENC_KEY;
  if (!b64) {
    throw new Error('BANK_DETAILS_ENC_KEY is not set — bank detail storage is not configured yet.');
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('BANK_DETAILS_ENC_KEY must decode to exactly 32 bytes (generate with: openssl rand -base64 32).');
  }
  return key;
}

// Output format: base64(iv) . base64(authTag) . base64(ciphertext) —
// joined with '.' so it's one plain TEXT column value.
export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const key = getKey();
  const iv = crypto.randomBytes(12); // 96-bit IV, standard for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decrypt(payload) {
  if (!payload) return null;
  const key = getKey();
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted payload.');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// True if bank detail storage is actually usable right now — lets routes
// give a clear "not configured yet" response instead of a raw 500.
export function isEncryptionConfigured() {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

// Masks a decrypted bank value for display — e.g. account numbers should
// never be shown in full in the admin UI after the initial entry.
export function maskTail(value, visibleChars = 3) {
  if (!value) return null;
  if (value.length <= visibleChars) return '•'.repeat(value.length);
  return '•'.repeat(value.length - visibleChars) + value.slice(-visibleChars);
}
