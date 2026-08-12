const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

let accessToken = null;
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function refreshAccessToken() {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include', // sends the httpOnly refresh cookie
  });
  if (!res.ok) throw new Error('Session expired');
  const data = await res.json();
  setAccessToken(data.accessToken);
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
