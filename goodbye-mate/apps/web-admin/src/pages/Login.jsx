import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

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
      <form onSubmit={onSubmit} style={styles.form}>
        <h1 style={styles.title}>Goodbye Mate — Admin</h1>
        {error && <p style={styles.error}>{error}</p>}
        <label style={styles.label}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={styles.input}
          />
        </label>
        <button type="submit" disabled={submitting} style={styles.button}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#f5f5f4', fontFamily: 'system-ui, sans-serif' },
  form: { width: 320, padding: 32, background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  title: { fontSize: 18, marginBottom: 20 },
  label: { display: 'block', fontSize: 13, color: '#555', marginBottom: 14 },
  input: { display: 'block', width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14 },
  button: { width: '100%', padding: '10px', borderRadius: 6, border: 'none', background: '#1f2937', color: '#fff', fontSize: 14, cursor: 'pointer' },
  error: { color: '#b91c1c', fontSize: 13, marginBottom: 12 },
};
