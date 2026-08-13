import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query } from '../db/pool.js';
import { signAccessToken, generateRefreshToken, hashRefreshToken } from '../auth/tokens.js';
import { requireAuth } from '../middleware/auth.js';
import { logAction } from '../audit/log.js';

const router = Router();

// Slow down credential-stuffing / brute-force attempts on login.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function setRefreshCookie(res, rawToken, expiresAt) {
  res.cookie('refresh_token', rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/api/auth', // only sent to auth endpoints
  });
}

router.post('/login', loginLimiter, async (req, res) => {
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

  const accessToken = signAccessToken(user);
  const { raw, hash, expiresAt } = generateRefreshToken();

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, hash, expiresAt, req.headers['user-agent'] || null, req.ip]
  );

  setRefreshCookie(res, raw, expiresAt);
  await logAction({ actorUserId: user.id, action: 'login_success', targetType: 'user', targetId: user.id });

  res.json({
    accessToken,
    // The native app has no cookie jar to rely on, so it stores this
    // itself (in secure on-device storage) and sends it back explicitly
    // on refresh. Web clients ignore this field and use the cookie instead.
    refreshToken: raw,
    user: { id: user.id, email: user.email, role: user.role, fullName: user.full_name },
  });
});

router.post('/refresh', async (req, res) => {
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
});

router.post('/logout', async (req, res) => {
  const raw = req.cookies?.refresh_token || req.body?.refreshToken;
  if (raw) {
    const hash = hashRefreshToken(raw);
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [hash]);
  }
  res.clearCookie('refresh_token', { path: '/api/auth' });
  res.status(204).end();
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT id, email, role, full_name, phone FROM users WHERE id = $1',
    [req.user.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: rows[0] });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

router.post('/change-password', requireAuth, async (req, res) => {
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
});

export default router;
