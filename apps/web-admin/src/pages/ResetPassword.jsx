import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import { LOGO_DATA_URI } from '../assets.js';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

/**
 * Two screens in one, chosen by whether a token is in the URL:
 * request a link, or set a new password.
 *
 * There was no password recovery at all before this. A vet had to ask
 * admin to change theirs, and an admin who forgot had no way back in —
 * for a sole admin, that's losing access to the whole business.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const request = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // Always shown, whether or not the address has an account — the
      // server deliberately doesn't say, and neither should this.
      setSent(true);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not reset your password');
      setDone(true);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Shell>
        <p style={styles.success}>Your password has been changed.</p>
        <p style={styles.hint}>
          You&apos;ve been signed out everywhere else, so any other device will need the new
          password.
        </p>
        <button onClick={() => navigate('/login')} style={styles.button}>Sign in</button>
      </Shell>
    );
  }

  if (sent) {
    return (
      <Shell>
        <p style={styles.success}>Check your email.</p>
        <p style={styles.hint}>
          If that address has an account, a reset link is on its way. It works once and expires
          in an hour.
        </p>
        <Link to="/login" style={styles.link}>Back to sign in</Link>
      </Shell>
    );
  }

  if (token) {
    return (
      <Shell>
        <p style={styles.subtitle}>Choose a new password</p>
        {error && <p style={styles.error}>{error}</p>}
        <form onSubmit={submit}>
          <label style={styles.label}>
            New password
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required minLength={10} autoComplete="new-password" autoFocus style={styles.input}
            />
          </label>
          <label style={styles.label}>
            Confirm it
            <input
              type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              required minLength={10} autoComplete="new-password" style={styles.input}
            />
          </label>
          <p style={styles.hint}>At least 10 characters.</p>
          <button type="submit" disabled={busy || !password || !confirm} style={styles.button}>
            {busy ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <p style={styles.subtitle}>Reset your password</p>
      {error && <p style={styles.error}>{error}</p>}
      <form onSubmit={request}>
        <label style={styles.label}>
          Email
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            required autoFocus autoComplete="email" style={styles.input}
          />
        </label>
        <button type="submit" disabled={busy || !email} style={styles.button}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <Link to="/login" style={styles.link}>Back to sign in</Link>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={styles.wrap}>
      <img src={LOGO_DATA_URI} alt="Goodbye Mate" style={styles.logo} />
      <div style={styles.card}>{children}</div>
    </div>
  );
}

const styles = {
  wrap: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--gm-paper)' },
  logo: { height: 34, marginBottom: 24 },
  card: { width: '100%', maxWidth: 360, background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius)', padding: 24 },
  subtitle: { fontFamily: 'var(--gm-font-display)', fontSize: 18, fontWeight: 600, marginBottom: 16 },
  success: { fontFamily: 'var(--gm-font-display)', fontSize: 18, fontWeight: 600, marginBottom: 10, color: 'var(--gm-forest)' },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 12 },
  input: { width: '100%', padding: '11px 12px', marginTop: 4, borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 15, fontFamily: 'inherit' },
  button: { width: '100%', background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '12px 0', fontSize: 15, fontWeight: 500, marginTop: 4 },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 14 },
  error: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 12 },
  link: { display: 'block', textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--gm-ink-soft)' },
};
