import { useState } from 'react';
import { useNavigate } from 'react-router';
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
  wrap: { display: 'flex', flexDirection: 'column', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--gm-forest)', padding: 24 },
  logo: { width: 260, height: 'auto', marginBottom: 32 },
  form: { width: 340, padding: '32px 32px 36px', background: '#fff', borderRadius: 14 },
  subtitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--gm-ink-soft)', marginBottom: 20, fontWeight: 600 },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 14 },
  input: { display: 'block', width: '100%', marginTop: 6, padding: '9px 11px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14 },
  button: { width: '100%', padding: '11px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 14, fontWeight: 500, marginTop: 6 },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 14 },
};
