import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const API_URL = Constants.expoConfig?.extra?.apiUrl || 'http://localhost:4000/api';

let accessToken = null;
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token;
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

export async function apiFetch(path, options = {}) {
  const doFetch = (token) =>
    fetch(`${API_URL}${path}`, {
      ...options,
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
      await setStoredRefreshToken(null);
      throw new Error('Not authenticated');
    }
  }

  return res;
}

export { API_URL };
