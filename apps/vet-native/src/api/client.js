import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const API_URL = Constants.expoConfig?.extra?.apiUrl || 'http://localhost:4000/api';

let accessToken = null;
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token;
}

/**
 * Current access token.
 *
 * Needed because React Native can't fetch a PDF into a blob and trigger
 * a download the way a browser can — PDFs are opened in the device
 * browser instead, which means attaching the token to the URL or a
 * header at the call site.
 */
export function getAccessToken() {
  return accessToken;
}

export async function getStoredRefreshToken() {
  return SecureStore.getItemAsync('refreshToken');
}

export async function setStoredRefreshToken(token) {
  if (token) await SecureStore.setItemAsync('refreshToken', token);
  else await SecureStore.deleteItemAsync('refreshToken');
}

async function refreshAccessToken() {
  const refreshToken = await getStoredRefreshToken();
  if (!refreshToken) throw new Error('No refresh token stored');

  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new Error('Session expired');
  const data = await res.json();
  setAccessToken(data.accessToken);
  await setStoredRefreshToken(data.refreshToken);
  return data.accessToken;
}

// React Native's fetch has NO default timeout. On a weak connection —
// a phone tethered to a hotspot, a rural property with one bar — a
// request can hang indefinitely. At startup that leaves the app on a
// loading screen forever, looking broken. 15s is long enough for a slow
// mobile connection and short enough to fail visibly.
const REQUEST_TIMEOUT_MS = 15000;

export async function apiFetch(path, options = {}) {
  const doFetch = async (token) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${API_URL}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });
    } catch (err) {
      // Give the abort a message a person can act on, rather than the
      // bare "Aborted" that React Native surfaces.
      if (err.name === 'AbortError') {
        // cause preserves the original AbortError for the console,
        // while the message stays something a vet can act on.
        throw new Error('The server took too long to respond. Check your connection and try again.', { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await doFetch(accessToken);

  if (res.status === 401 && path !== '/auth/refresh') {
    refreshPromise = refreshPromise || refreshAccessToken().finally(() => { refreshPromise = null; });
    try {
      const newToken = await refreshPromise;
      res = await doFetch(newToken);
    } catch {
      setAccessToken(null);
      await setStoredRefreshToken(null);
      throw new Error('Not authenticated');
    }
  }

  return res;
}

export { API_URL };
