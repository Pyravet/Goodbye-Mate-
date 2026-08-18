import { verifyAccessToken } from '../auth/tokens.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  try {
    req.user = verifyAccessToken(token); // { sub, role, email }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired access token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      // Say what was required vs. what the account actually has. A bare
      // "Forbidden" made a wrong-role account indistinguishable from a
      // broken endpoint, which cost real debugging time.
      return res.status(403).json({
        error: `Forbidden — this action needs a ${roles.join(' or ')} account, but you're signed in as ${req.user?.role || 'unknown'}. Log out and back in if your role was changed recently.`,
      });
    }
    next();
  };
}
