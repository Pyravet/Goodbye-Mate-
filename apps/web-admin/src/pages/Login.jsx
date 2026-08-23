import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../AuthContext.jsx';
import { LOGO_DATA_URI } from '../assets.js';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login, loginWithTwoFactor } = useAuth();
  // Set once the password is accepted and a code is needed. Its presence
  // is what switches this form into the second step.
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await login(email, password);
      // Needing a second factor is not an error — the password was
      // correct, there's just another step.
      if (result?.twoFactorRequired) {
        setChallenge(result.challenge);
        return;
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitCode = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await loginWithTwoFactor(challenge, code);
      navigate('/');
    } catch (err) {
      setError(err.message);
      setCode('');
    } finally {
      setSubmitting(false);
    }
  };

  if (challenge) {
    return (
      <div style={styles.wrap}>
        <img src={LOGO_DATA_URI} alt="Goodbye Mate" style={styles.logo} />
        <form onSubmit={onSubmitCode} style={styles.form}>
          <p style={styles.subtitle}>Two-step verification</p>
          {error && <p style={styles.error}>{error}</p>}
          <p style={styles.hint}>
            Enter the 6-digit code from your authenticator app.
          </p>
          <label style={styles.label}>
            Code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
              // inputMode numeric brings up the number pad on a phone,
              // but the field stays text so a recovery code still works.
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              style={{ ...styles.input, letterSpacing: 4, fontSize: 20, textAlign: 'center' }}
            />
          </label>
          <button type="submit" disabled={submitting || !code.trim()} style={styles.button}>
            {submitting ? 'Checking…' : 'Verify'}
          </button>
          <p style={styles.hint}>
            Lost your phone? Enter one of your recovery codes instead.
          </p>
          <button
            type="button"
            onClick={() => { setChallenge(null); setCode(''); setError(''); }}
            style={styles.linkBtn}
          >
            Back to sign in
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <img src={LOGO_DATA_URI} alt="Goodbye Mate" style={styles.logo} />
      <form onSubmit={onSubmit} style={styles.form}>
        <p style={styles.subtitle}>Admin</p>
        {error && <p style={styles.error}>{error}</p>}
        <label style={styles.label}>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={styles.input} autoFocus />
        </label>
        <label style={styles.label}>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={styles.input} />
        </label>
        <button type="submit" disabled={submitting} style={styles.button}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  hint: { fontSize: 13, color: 'var(--gm-ink-soft)', lineHeight: 1.5, marginBottom: 14, textAlign: 'center' },
  linkBtn: { background: 'none', border: 'none', color: 'var(--gm-ink-soft)', fontSize: 12, textDecoration: 'underline', marginTop: 10, cursor: 'pointer', width: '100%' },
  wrap: { display: 'flex', flexDirection: 'column', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--gm-forest)', padding: 24 },
  logo: { width: 260, height: 'auto', marginBottom: 32 },
  form: { width: 340, padding: '32px 32px 36px', background: '#fff', borderRadius: 14 },
  subtitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--gm-ink-soft)', marginBottom: 20, fontWeight: 600 },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 14 },
  input: { display: 'block', width: '100%', marginTop: 6, padding: '9px 11px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14 },
  button: { width: '100%', padding: '11px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 14, fontWeight: 500, marginTop: 6 },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 14 },
};
