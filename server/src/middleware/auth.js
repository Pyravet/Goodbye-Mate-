import { verifyAccessToken } from '../auth/tokens.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;

  // Fallback: ?token= on the query string.
  //
  // Needed for PDFs opened in the DEVICE BROWSER from the native app —
  // React Native can't fetch a document into a blob and hand it to a
  // viewer the way a web page can, and the system browser won't carry
  // our Authorization header. Restricted to GET so a token in a URL can
  // never trigger a state change, and access tokens are short-lived, so
  // a URL that leaks into browser history stops working quickly.
  // Additionally restricted to .pdf paths: this exists solely so the
  // device browser can open a document, and a token in a URL is far more
  // exposure-prone than a header (browser history, referrer headers,
  // shared links), so the smallest possible surface is right.
  if (
    !token
    && req.method === 'GET'
    && typeof req.query?.token === 'string'
    && req.path.endsWith('.pdf')
  ) {
    token = req.query.token;
  }

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
