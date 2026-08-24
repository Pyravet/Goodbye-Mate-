import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query, pool } from '../db/pool.js';
import { signAccessToken, generateRefreshToken, hashRefreshToken } from '../auth/tokens.js';
import { requireAuth } from '../middleware/auth.js';
import { logAction } from '../audit/log.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { sendPushToAdmins } from '../integrations/push/webPush.js';
import { sendSlackMessage } from '../integrations/slack/webhook.js';
import crypto from 'node:crypto';
import { generateTotpSecret, verifyTotp, totpUri, generateRecoveryCodes } from '../security/totp.js';
import { encrypt, decrypt, isEncryptionConfigured } from '../security/encryption.js';
import QRCode from 'qrcode';
import { sendEmail, isEmailConfigured } from '../integrations/email/smtp.js';

/**
 * Issue everything a successful login returns.
 *
 * Extracted because the flow now has TWO exits — straight through when
 * 2FA is off, and after code verification when it's on — and duplicating
 * refresh-token creation across both is how the two paths drift apart.
 */
async function completeLogin(req, res, user) {
  const accessToken = signAccessToken(user);
  const { raw, hash, expiresAt } = generateRefreshToken();

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, hash, expiresAt, req.headers['user-agent'] || null, req.ip]
  );

  setRefreshCookie(res, raw, expiresAt);
  await logAction({ actorUserId: user.id, action: 'login_success', targetType: 'user', targetId: user.id });

  return res.json({
    accessToken,
    refreshToken: raw,
    user: { id: user.id, email: user.email, role: user.role, fullName: user.full_name },
  });
}

const router = Router();

// Slow down credential-stuffing / brute-force attempts on login.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

// Same idea as loginLimiter — an authenticated user could otherwise
// brute-force their own current-password check with no throttle at all.
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Cross-site cookie: the frontend (Vercel) and API (Railway) are on
// different domains, so the browser only ever sends this cookie if it's
// SameSite=None + Secure. SameSite=Lax (the old setting) is NEVER sent on
// a cross-site fetch()/XHR — only on top-level navigation — so silent
// refresh-on-reload was failing every single time in production,
// appearing to the user as "logged out on refresh". Secure=None requires
// HTTPS, which is fine in production; in local dev (http://localhost)
// browsers reject Secure cookies, so fall back to Lax there since
// frontend and backend are effectively same-site on localhost anyway.
const isProd = process.env.NODE_ENV === 'production';
const REFRESH_COOKIE_OPTIONS_BASE = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  path: '/api/auth', // only sent to auth endpoints
};

function setRefreshCookie(res, rawToken, expiresAt) {
  res.cookie('refresh_token', rawToken, {
    ...REFRESH_COOKIE_OPTIONS_BASE,
    expires: expiresAt,
  });
}

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid email or password format' });
  }
  const { email, password } = parsed.data;

  const { rows } = await query(
    'SELECT id, email, password_hash, role, full_name, is_active FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  const user = rows[0];

  // Deliberately generic error — don't reveal whether the email exists.
  const genericError = () => res.status(401).json({ error: 'Invalid email or password' });

  if (!user || !user.is_active) return genericError();

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    await logAction({ actorUserId: null, action: 'login_failed', targetType: 'user', targetId: user.id, metadata: { email } });
    return genericError();
  }

  // 2FA gate. The password was correct, but no tokens are issued yet —
  // a short-lived challenge is returned instead, so the password isn't
  // re-sent with the code and a half-finished login can't be resumed
  // days later.
  const { rows: totpRows } = await query(
    'SELECT totp_enabled_at FROM users WHERE id = $1', [user.id]
  );
  if (totpRows[0]?.totp_enabled_at) {
    const challenge = crypto.randomBytes(32).toString('hex');
    const challengeHash = crypto.createHash('sha256').update(challenge).digest('hex');
    await query(
      `INSERT INTO totp_challenges (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + INTERVAL '5 minutes')`,
      [user.id, challengeHash]
    );
    return res.json({ twoFactorRequired: true, challenge });
  }

  return completeLogin(req, res, user);
}));

const totpLoginSchema = z.object({
  challenge: z.string().min(1),
  code: z.string().trim().min(6).max(20),
});

/**
 * POST /auth/login/2fa — second step of login.
 *
 * Rate-limited with the same limiter as login: a 6-digit code is
 * brute-forceable in minutes without one.
 */
router.post('/login/2fa', loginLimiter, asyncHandler(async (req, res) => {
  const parsed = totpLoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });

  const challengeHash = crypto.createHash('sha256')
    .update(parsed.data.challenge).digest('hex');

  // Consume the challenge atomically, so a replayed challenge can't be
  // used for a second attempt.
  const { rows: challengeRows } = await query(
    `UPDATE totp_challenges SET consumed_at = now()
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [challengeHash]
  );
  if (!challengeRows[0]) {
    return res.status(401).json({ error: 'That sign-in attempt has expired. Please start again.' });
  }

  const { rows: userRows } = await query(
    `SELECT id, email, role, full_name, is_active, totp_secret_enc, totp_recovery_codes
     FROM users WHERE id = $1`,
    [challengeRows[0].user_id]
  );
  const user = userRows[0];
  if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid sign-in' });

  const code = parsed.data.code.replace(/\s/g, '');
  let ok = false;
  let usedRecovery = false;

  if (/^\d{6}$/.test(code)) {
    ok = verifyTotp(decrypt(user.totp_secret_enc), code);
  } else {
    // Recovery code. Single use: matched by hash, then REMOVED, so a
    // written-down code can't be replayed if the paper is found.
    const stored = user.totp_recovery_codes || [];
    for (const hash of stored) {
      if (await bcrypt.compare(code.toUpperCase(), hash)) {
        ok = true;
        usedRecovery = true;
        await query(
          `UPDATE users SET totp_recovery_codes = $1 WHERE id = $2`,
          [JSON.stringify(stored.filter((h) => h !== hash)), user.id]
        );
        break;
      }
    }
  }

  if (!ok) {
    await logAction({ actorUserId: user.id, action: 'login_2fa_failed', targetType: 'user', targetId: user.id });
    return res.status(401).json({ error: 'That code is not right. Check your authenticator app.' });
  }

  if (usedRecovery) {
    await logAction({ actorUserId: user.id, action: 'login_2fa_recovery_used', targetType: 'user', targetId: user.id });
    sendSlackMessage(`🔑 Recovery code used to sign in: ${user.email}`)
      .catch((e) => console.error('recovery alert failed:', e.message));
  }

  return completeLogin(req, res, user);
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const raw = req.cookies?.refresh_token || req.body?.refreshToken;
  if (!raw) return res.status(401).json({ error: 'No refresh token' });

  const hash = hashRefreshToken(raw);
  const { rows } = await query(
    `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.email, u.role, u.is_active
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1`,
    [hash]
  );
  const tokenRow = rows[0];

  if (!tokenRow || tokenRow.revoked_at || new Date(tokenRow.expires_at) < new Date() || !tokenRow.is_active) {
    return res.status(401).json({ error: 'Refresh token invalid or expired' });
  }

  // Rotate: revoke the old refresh token, issue a new one. Limits the
  // damage window if a refresh token is ever stolen.
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [tokenRow.id]);

  const { raw: newRaw, hash: newHash, expiresAt } = generateRefreshToken();
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [tokenRow.user_id, newHash, expiresAt, req.headers['user-agent'] || null, req.ip]
  );
  setRefreshCookie(res, newRaw, expiresAt);

  const accessToken = signAccessToken({ id: tokenRow.user_id, role: tokenRow.role, email: tokenRow.email });
  res.json({ accessToken, refreshToken: newRaw });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const raw = req.cookies?.refresh_token || req.body?.refreshToken;
  if (raw) {
    const hash = hashRefreshToken(raw);
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [hash]);
  }
  res.clearCookie('refresh_token', REFRESH_COOKIE_OPTIONS_BASE);
  res.status(204).end();
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT id, email, role, full_name, phone FROM users WHERE id = $1',
    [req.user.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: rows[0] });
}));

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

router.post('/change-password', requireAuth, changePasswordLimiter, asyncHandler(async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.sub]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });

  const valid = await bcrypt.compare(parsed.data.currentPassword, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [newHash, req.user.sub]);
  await logAction({ actorUserId: req.user.sub, action: 'password_changed', targetType: 'user', targetId: req.user.sub });

  // Revoke all existing refresh tokens so other sessions require re-login
  // with the new password — standard practice after a password change.
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.sub]);

  res.status(204).end();
}));

// Self-service vet signup — public, no auth required. Creates the account
// with is_active = false: the login route already blocks inactive users,
// so a pending vet literally cannot log in until an admin approves them.
// That's also why login gives a deliberately generic error rather than
// "your account is pending" — this signup response is where a new vet
// finds out their application needs approval, not a failed login attempt.
const vetSignupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts. Try again later.' },
});

const vetSignupSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  regNumber: z.string().min(1, 'Registration number is required'),
  regState: z.string().min(1, 'Registration state is required'),
});

router.post('/vet-signup', vetSignupLimiter, asyncHandler(async (req, res) => {
  const parsed = vetSignupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid signup', details: parsed.error.flatten() });
  const d = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const passwordHash = await bcrypt.hash(d.password, 12);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (email, password_hash, role, full_name, phone, is_active)
       VALUES ($1,$2,'vet',$3,$4,false) RETURNING id`,
      [d.email.toLowerCase(), passwordHash, d.fullName, d.phone]
    );
    const userId = userRows[0].id;

    const { rows: vetRows } = await client.query(
      `INSERT INTO vets (user_id, reg_number, reg_state) VALUES ($1,$2,$3) RETURNING id`,
      [userId, d.regNumber, d.regState]
    );
    const vetId = vetRows[0].id;

    await client.query('COMMIT');
    await logAction({ actorUserId: null, action: 'vet_signup', targetType: 'user', targetId: userId, metadata: { email: d.email.toLowerCase() } });

    sendPushToAdmins({
      title: 'New vet application',
      body: `${d.fullName} applied — reg. ${d.regNumber} (${d.regState})`,
      url: `/vets/${vetId}`,
    }).catch((err) => console.error('Admin push for vet signup failed:', err.message));
    sendSlackMessage(`🐾 New vet application: *${d.fullName}* (${d.email}) — reg. ${d.regNumber} (${d.regState}). Review in the admin app.`)
      .catch((err) => console.error('Slack notify for vet signup failed:', err.message));

    res.status(201).json({
      ok: true,
      message: 'Thanks — your application has been received. An admin will review your registration details and activate your account; you\'ll be able to log in once approved.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    throw err;
  } finally {
    client.release();
  }
}));


// --- Password reset ---

/**
 * Tighter than the login limiter.
 *
 * This endpoint sends email to an address the caller chooses, so an
 * unlimited one is both an account-enumeration tool and a way to use the
 * system to spam someone else's inbox.
 */
const resetRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset requests. Please try again later.' },
});

const forgotSchema = z.object({ email: z.string().trim().email() });

/**
 * POST /auth/forgot-password
 *
 * ALWAYS returns the same response, whether or not the address exists.
 * Confirming which emails have accounts turns this into a list of who
 * works here — and for a vet roster that's personal information the
 * business has no reason to publish.
 */
router.post('/forgot-password', resetRequestLimiter, asyncHandler(async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body || {});
  // Even a malformed address gets the neutral answer, so the shape of
  // the response never distinguishes "no account" from "bad input".
  const generic = { ok: true, message: 'If that email has an account, a reset link is on its way.' };
  if (!parsed.success) return res.json(generic);

  const email = parsed.data.email.toLowerCase();
  const { rows } = await query(
    'SELECT id, email, full_name FROM users WHERE lower(email) = $1 AND is_active = true',
    [email]
  );
  const user = rows[0];

  if (user && isEmailConfigured()) {
    const raw = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');

    // Any earlier unused link stops working. Otherwise a user who
    // requests three times has three live keys, and the two they didn't
    // use sit in the inbox indefinitely.
    await query(
      `UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );
    await query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at, requested_ip)
       VALUES ($1, $2, now() + INTERVAL '1 hour', $3)`,
      [user.id, hash, req.ip || null]
    );

    const base = process.env.ADMIN_APP_URL || process.env.CLIENT_APP_URL || '';
    const link = `${base}/reset-password?token=${raw}`;

    sendEmail({
      to: user.email,
      subject: 'Reset your Goodbye Mate password',
      html: `<p>Hi ${user.full_name || ''},</p>`
        + `<p>Someone asked to reset the password for this account. `
        + `<a href="${link}">Choose a new password</a>.</p>`
        + `<p>This link works once and expires in an hour.</p>`
        + `<p>If this wasn't you, you can ignore this email — nothing has changed.</p>`,
    }).catch((err) => console.error('Password reset email failed:', err.message));

    await logAction({ actorUserId: user.id, action: 'password_reset_requested', targetType: 'user', targetId: user.id });
  }

  res.json(generic);
}));

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10, 'Use at least 10 characters.'),
});

/**
 * POST /auth/reset-password
 */
router.post('/reset-password', resetRequestLimiter, asyncHandler(async (req, res) => {
  const parsed = resetSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid request' });
  }

  const hash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');

  // Consumed atomically: a link that can be used twice is a link that
  // still works after the person has moved on.
  const { rows } = await query(
    `UPDATE password_resets SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [hash]
  );
  if (!rows[0]) {
    return res.status(400).json({ error: 'That link has expired or has already been used. Please request a new one.' });
  }

  const userId = rows[0].user_id;
  await query('UPDATE users SET password_hash = $1 WHERE id = $2',
    [await bcrypt.hash(parsed.data.password, 10), userId]);

  // Every existing session ends. A password reset is often prompted by
  // a suspected compromise, and leaving old sessions alive would defeat
  // the point entirely.
  await query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );

  await logAction({ actorUserId: userId, action: 'password_reset_completed', targetType: 'user', targetId: userId });

  const { rows: userRows } = await query('SELECT email FROM users WHERE id = $1', [userId]);
  sendSlackMessage(`🔑 Password was reset for ${userRows[0]?.email}`)
    .catch((e) => console.error('reset alert failed:', e.message));

  res.json({ ok: true });
}));

// --- Two-factor setup and management ---

/**
 * GET /auth/2fa/status — is 2FA on for this account?
 */
router.get('/2fa/status', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT totp_enabled_at, totp_recovery_codes FROM users WHERE id = $1',
    [req.user.sub]
  );
  res.json({
    enabled: !!rows[0]?.totp_enabled_at,
    enabledAt: rows[0]?.totp_enabled_at || null,
    recoveryCodesRemaining: (rows[0]?.totp_recovery_codes || []).length,
  });
}));

/**
 * POST /auth/2fa/setup — generate a secret and QR code.
 *
 * Does NOT enable 2FA. The secret is stored but stays inert until a
 * correct code is confirmed, so someone who scans the QR and then loses
 * their phone mid-setup isn't locked out of their own account.
 */
router.post('/2fa/setup', requireAuth, asyncHandler(async (req, res) => {
  if (!isEncryptionConfigured()) {
    return res.status(503).json({
      error: 'Encryption is not configured on the server, so a 2FA secret cannot be stored safely.',
    });
  }

  const { rows } = await query('SELECT email, totp_enabled_at FROM users WHERE id = $1', [req.user.sub]);
  if (rows[0]?.totp_enabled_at) {
    return res.status(409).json({ error: 'Two-factor authentication is already on for this account.' });
  }

  const secret = generateTotpSecret();
  await query('UPDATE users SET totp_secret_enc = $1 WHERE id = $2', [encrypt(secret), req.user.sub]);

  const uri = totpUri(secret, rows[0].email);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 240 });

  res.json({
    qrDataUrl,
    // Shown so it can be typed by hand when a camera won't cooperate —
    // a QR-only setup strands anyone on a desktop without a webcam.
    secret,
    uri,
  });
}));

const confirmSchema = z.object({ code: z.string().trim().min(6).max(10) });

/**
 * POST /auth/2fa/confirm — prove the app works, then turn 2FA on.
 *
 * Returns the recovery codes exactly ONCE. They're stored hashed, so
 * there is no way to show them again — the response says so.
 */
router.post('/2fa/confirm', requireAuth, asyncHandler(async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter the 6-digit code.' });

  const { rows } = await query(
    'SELECT totp_secret_enc, totp_enabled_at FROM users WHERE id = $1', [req.user.sub]
  );
  if (!rows[0]?.totp_secret_enc) {
    return res.status(400).json({ error: 'Start the setup again — no secret is pending.' });
  }
  if (rows[0].totp_enabled_at) {
    return res.status(409).json({ error: 'Two-factor authentication is already on.' });
  }

  if (!verifyTotp(decrypt(rows[0].totp_secret_enc), parsed.data.code)) {
    return res.status(400).json({
      error: "That code isn't right. Check your phone's clock is set automatically, then try the current code.",
    });
  }

  const recoveryCodes = generateRecoveryCodes(8);
  const hashes = await Promise.all(recoveryCodes.map((c) => bcrypt.hash(c, 10)));

  await query(
    `UPDATE users SET totp_enabled_at = now(), totp_recovery_codes = $1 WHERE id = $2`,
    [JSON.stringify(hashes), req.user.sub]
  );

  await logAction({ actorUserId: req.user.sub, action: '2fa_enabled', targetType: 'user', targetId: req.user.sub });

  res.json({
    enabled: true,
    recoveryCodes,
    warning: 'Save these now. They are stored hashed and cannot be shown again.',
  });
}));

const disableSchema = z.object({
  password: z.string().min(1),
  code: z.string().trim().min(6).max(20),
});

/**
 * POST /auth/2fa/disable
 *
 * Requires BOTH the password and a current code. Turning off a second
 * factor from an already-authenticated session would mean anyone with a
 * borrowed logged-in browser could strip the protection — which is
 * exactly the scenario 2FA exists to cover.
 */
router.post('/2fa/disable', requireAuth, asyncHandler(async (req, res) => {
  const parsed = disableSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Password and current code are both required.' });

  const { rows } = await query(
    'SELECT password_hash, totp_secret_enc, totp_enabled_at FROM users WHERE id = $1',
    [req.user.sub]
  );
  if (!rows[0]?.totp_enabled_at) {
    return res.status(400).json({ error: 'Two-factor authentication is not on.' });
  }

  if (!(await bcrypt.compare(parsed.data.password, rows[0].password_hash))) {
    return res.status(401).json({ error: 'That password is not right.' });
  }
  if (!verifyTotp(decrypt(rows[0].totp_secret_enc), parsed.data.code)) {
    return res.status(401).json({ error: 'That code is not right.' });
  }

  await query(
    `UPDATE users SET totp_enabled_at = NULL, totp_secret_enc = NULL,
       totp_recovery_codes = '[]'::jsonb WHERE id = $1`,
    [req.user.sub]
  );

  await logAction({ actorUserId: req.user.sub, action: '2fa_disabled', targetType: 'user', targetId: req.user.sub });
  sendSlackMessage(`⚠️ Two-factor authentication was turned OFF for ${req.user.email || req.user.sub}`)
    .catch((e) => console.error('2fa disable alert failed:', e.message));

  res.json({ enabled: false });
}));

export default router;
