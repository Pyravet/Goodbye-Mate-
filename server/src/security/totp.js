import crypto from 'node:crypto';

/**
 * TOTP (RFC 6238) built on Node's crypto.
 *
 * Implemented directly rather than pulled from a package: the algorithm
 * is ~40 lines, Node already provides the HMAC, and the current otplib
 * major requires registering crypto and base32 plugins — more moving
 * parts and more supply-chain surface than the problem deserves for a
 * standard every authenticator app implements identically.
 *
 * Compatible with Google Authenticator, Authy, 1Password, iOS Passwords
 * and anything else supporting standard TOTP: SHA-1, 6 digits, 30s.
 */

const DIGITS = 6;
const PERIOD_SECONDS = 30;
const ALGORITHM = 'sha1'; // What authenticator apps assume by default.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode bytes as unpadded base32 — the format authenticator apps expect. */
function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  // Tolerate the spaces and lowercase people paste in when typing a
  // secret by hand, and the padding some tools add.
  const clean = String(input).toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character in TOTP secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret, 20 bytes as RFC 4226 recommends for SHA-1. */
export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * The code for a given time step.
 * @param {string} secret base32
 * @param {number} [counter] time step; defaults to now
 */
export function generateTotp(secret, counter = Math.floor(Date.now() / 1000 / PERIOD_SECONDS)) {
  const key = base32Decode(secret);

  // 8-byte big-endian counter.
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac(ALGORITHM, key).update(buf).digest();

  // Dynamic truncation (RFC 4226 §5.3).
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Verify a submitted code.
 *
 * `window` accepts codes one step either side of now (±30s) to tolerate
 * clock drift between the phone and the server — without it, a phone a
 * few seconds out simply never works, which users experience as "2FA is
 * broken" rather than "my clock is wrong".
 *
 * Comparison is constant-time: a timing side channel on a 6-digit code
 * with a 30-second window is a genuinely feasible attack.
 */
export function verifyTotp(secret, token, window = 1) {
  if (!secret || !token) return false;
  const clean = String(token).replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;

  const now = Math.floor(Date.now() / 1000 / PERIOD_SECONDS);
  for (let i = -window; i <= window; i++) {
    const expected = generateTotp(secret, now + i);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}

/** otpauth:// URI for the QR code. */
export function totpUri(secret, accountEmail, issuer = 'Goodbye Mate') {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: ALGORITHM.toUpperCase(),
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Single-use recovery codes, for a lost or wiped phone.
 *
 * Without these, losing the authenticator means losing the account —
 * and for a sole admin that means losing access to the whole business.
 * Returned in plaintext ONCE at setup; only hashes are stored.
 */
export function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () =>
    // Ambiguous characters excluded: these get written down and read
    // back under stress, where 0/O and 1/I/l are a real problem.
    crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g).join('-')
  );
}
