const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// Access token stays in memory only — short-lived, and never persisted.
let accessToken = null;
let refreshPromise = null;

/**
 * Refresh-token persistence.
 *
 * WHY NOT JUST THE COOKIE: the server does set an httpOnly refresh
 * cookie, and that remains the preferred mechanism. But the frontends
 * are served from *.vercel.app while the API lives on *.railway.app —
 * different registrable domains — so that cookie is a THIRD-PARTY
 * cookie. Safari blocks third-party cookies outright by default (ITP),
 * and Chrome is phasing them out. On iPhone the cookie is therefore
 * never stored, the silent refresh on page load fails, and the app
 * concludes the session is dead and signs the user out on every reload.
 *
 * So we keep a copy of the refresh token in localStorage and send it in
 * the request body. The server already accepts either source
 * (`req.cookies?.refresh_token || req.body?.refreshToken`) and rotates
 * the token on every use, so a stolen token has a short useful life.
 *
 * TRADE-OFF, stated plainly: a token in localStorage is readable by
 * JavaScript, so it is weaker than httpOnly against XSS. That is
 * accepted here because (a) the app has no XSS sinks — no
 * dangerouslySetInnerHTML, no eval, React escapes by default — and
 * (b) the alternative is an app that cannot stay logged in on iOS at
 * all. The correct long-term fix is to serve the API from a subdomain
 * of the same site as the apps (e.g. api.goodbyemate.com.au +
 * app.goodbyemate.com.au), which makes the cookie first-party again;
 * at that point this fallback can be removed.
 */
const REFRESH_TOKEN_KEY = 'gm_refresh_token';

function readStoredRefreshToken() {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    // Private browsing / storage disabled — fall back to cookie-only.
    return null;
  }
}

export function setStoredRefreshToken(token) {
  try {
    if (token) localStorage.setItem(REFRESH_TOKEN_KEY, token);
    else localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    /* storage unavailable — cookie path still applies where it works */
  }
}

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function refreshAccessToken() {
  const stored = readStoredRefreshToken();

  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include', // still sends the cookie where it isn't blocked
    headers: { 'Content-Type': 'application/json' },
    // Body copy for browsers that drop the third-party cookie.
    body: JSON.stringify(stored ? { refreshToken: stored } : {}),
  });
  if (!res.ok) {
    // Refresh genuinely failed — clear the stale token so we don't retry
    // it forever on every subsequent request.
    setStoredRefreshToken(null);
    throw new Error('Session expired');
  }

  const data = await res.json();
  setAccessToken(data.accessToken);
  // The server rotates the refresh token on every use, so store the new
  // one or the next refresh will present an already-revoked token.
  if (data.refreshToken) setStoredRefreshToken(data.refreshToken);
  return data.accessToken;
}

// Wrapped fetch: attaches the access token, and on a 401 tries exactly
// one silent refresh-and-retry before giving up.
export async function apiFetch(path, options = {}) {
  const doFetch = (token) =>
    fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

  let res = await doFetch(accessToken);

  if (res.status === 401 && path !== '/auth/refresh') {
    refreshPromise = refreshPromise || refreshAccessToken().finally(() => { refreshPromise = null; });
    try {
      const newToken = await refreshPromise;
      res = await doFetch(newToken);
    } catch {
      setAccessToken(null);
      throw new Error('Not authenticated');
    }
  }

  return res;
}

export { API_URL };
