import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  generateTotpSecret, generateTotp, verifyTotp, totpUri, generateRecoveryCodes,
} from './totp.js';

/**
 * The RFC 6238 test vectors are the whole point of this file.
 *
 * A TOTP implementation that looks right but is subtly wrong (byte
 * order, truncation offset, digit modulus) fails in the worst possible
 * way: it generates codes consistently, verifies its own codes happily,
 * and passes any test written against itself — while rejecting every
 * code a real authenticator app produces. Checking against the published
 * vectors is the only way to know we match the standard rather than
 * merely matching ourselves.
 */

// RFC 6238 Appendix B, SHA-1 rows. Secret is ASCII "12345678901234567890".
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('RFC 6238 test vectors — SHA-1', () => {
  const vectors = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];
  for (const [unixTime, expected] of vectors) {
    const counter = Math.floor(unixTime / 30);
    assert.equal(
      generateTotp(RFC_SECRET_BASE32, counter),
      expected,
      `RFC vector at t=${unixTime} must produce ${expected}`
    );
  }
});

test('generated secret is valid base32 and usable', () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]+$/, 'base32 alphabet only, no padding');
  assert.equal(secret.length, 32, '20 random bytes encode to 32 base32 chars');
  assert.match(generateTotp(secret), /^\d{6}$/);
});

test('verify accepts the current code and rejects a wrong one', () => {
  const secret = generateTotpSecret();
  assert.equal(verifyTotp(secret, generateTotp(secret)), true);
  assert.equal(verifyTotp(secret, '000000'), false);
});

test('verify tolerates one step of clock drift either side', () => {
  const secret = generateTotpSecret();
  const now = Math.floor(Date.now() / 1000 / 30);

  assert.equal(verifyTotp(secret, generateTotp(secret, now - 1)), true, '30s behind');
  assert.equal(verifyTotp(secret, generateTotp(secret, now + 1)), true, '30s ahead');
  // Beyond the window it must fail — an unbounded window would let an
  // old intercepted code work indefinitely.
  assert.equal(verifyTotp(secret, generateTotp(secret, now - 5)), false, '2.5 min behind');
});

test('verify rejects malformed input without throwing', () => {
  const secret = generateTotpSecret();
  for (const bad of [null, undefined, '', 'abcdef', '12345', '1234567', '12 34 56x']) {
    assert.equal(verifyTotp(secret, bad), false, `must reject ${JSON.stringify(bad)}`);
  }
  // A missing secret must fail closed, not throw and 500 the login.
  assert.equal(verifyTotp(null, '123456'), false);
});

test('verify tolerates spaces in a pasted code', () => {
  const secret = generateTotpSecret();
  const code = generateTotp(secret);
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  assert.equal(verifyTotp(secret, spaced), true, 'apps display codes as "123 456"');
});

test('otpauth URI carries every parameter an authenticator needs', () => {
  const uri = totpUri('GEZDGNBVGY3TQOJQ', 'admin@goodbyemate.com.au');
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=GEZDGNBVGY3TQOJQ/);
  assert.match(uri, /issuer=Goodbye\+Mate/);
  assert.match(uri, /algorithm=SHA1/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});

test('recovery codes are distinct and unpredictable', () => {
  const codes = generateRecoveryCodes(8);
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8, 'no duplicates');
  for (const c of codes) assert.match(c, /^[0-9A-F]{5}-[0-9A-F]{5}$/);

  // Two separate calls must not overlap — if they did, the generator
  // isn't actually random and codes would be guessable.
  const second = generateRecoveryCodes(8);
  assert.equal(codes.filter((c) => second.includes(c)).length, 0);
});

test('secret decoding tolerates lowercase, spaces and padding', () => {
  // People type these by hand when a QR scan fails.
  const code = generateTotp(RFC_SECRET_BASE32, 59 / 30 | 0);
  assert.equal(generateTotp(RFC_SECRET_BASE32.toLowerCase(), 1), generateTotp(RFC_SECRET_BASE32, 1));
  assert.equal(
    generateTotp('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ', 1),
    generateTotp(RFC_SECRET_BASE32, 1)
  );
  assert.match(code, /^\d{6}$/);
});
