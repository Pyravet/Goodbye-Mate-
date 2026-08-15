import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { LOGO_DATA_URI } from '../assets.js';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.wrap}>
      <img src={LOGO_DATA_URI} alt="Goodbye Mate" style={styles.logo} />
      <form onSubmit={onSubmit} style={styles.form}>
        <p style={styles.subtitle}>Vet sign in</p>
        {error && <p style={styles.error}>{error}</p>}
        <label style={styles.label}>
          Email
          <input type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required style={styles.input} autoFocus />
        </label>
        <label style={styles.label}>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required style={styles.input} />
        </label>
        <button type="submit" disabled={submitting} style={styles.button}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <Link to="/signup" style={styles.link}>New vet? Apply here</Link>
      </form>
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', minHeight: '100dvh', alignItems: 'center', justifyContent: 'center', background: 'var(--gm-forest)', padding: 24 },
  logo: { width: 220, height: 'auto', marginBottom: 28 },
  form: { width: '100%', maxWidth: 340, padding: '28px 24px 32px', background: '#fff', borderRadius: 14 },
  subtitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--gm-ink-soft)', marginBottom: 18, fontWeight: 600 },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 14 },
  input: { display: 'block', width: '100%', marginTop: 6, padding: '11px 12px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 16 },
  button: { width: '100%', padding: '13px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 15, fontWeight: 500, marginTop: 6 },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 14 },
  link: { display: 'block', textAlign: 'center', fontSize: 13, color: 'var(--gm-forest)', marginTop: 16, textDecoration: 'none', fontWeight: 500 },
};
