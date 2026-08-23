import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch, setAccessToken, setStoredRefreshToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    try {
      const res = await apiFetch('/auth/me');
      if (!res.ok) throw new Error('not authed');
      const data = await res.json();
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const login = async (email, password) => {
    const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000/api'}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Login failed');
    }
    const data = await res.json();

    // 2FA: the password was right but no tokens were issued. Hand the
    // challenge back to the caller so it can collect a code. Returning a
    // shaped object rather than throwing keeps this off the error path —
    // needing a second factor is not a failure.
    if (data.twoFactorRequired) {
      return { twoFactorRequired: true, challenge: data.challenge };
    }

    return applySession(data);
  };

  /**
   * Second step of a 2FA login.
   * @param {string} challenge from login()
   * @param {string} code 6-digit TOTP, or a recovery code
   */
  const loginWithTwoFactor = async (challenge, code) => {
    const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000/api'}/auth/login/2fa`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge, code }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'That code was not accepted');
    }
    return applySession(await res.json());
  };

  /**
   * Store a completed session. Shared by both login paths so they can't
   * drift — a session established one way must behave identically.
   */
  function applySession(data) {
    setAccessToken(data.accessToken);
    // Persist the refresh token so the session survives a page reload
    // even where the third-party cookie is blocked (Safari/iOS).
    if (data.refreshToken) setStoredRefreshToken(data.refreshToken);
    setUser(data.user);
    return data.user;
  }

  const logout = async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    setAccessToken(null);
    setStoredRefreshToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithTwoFactor, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
