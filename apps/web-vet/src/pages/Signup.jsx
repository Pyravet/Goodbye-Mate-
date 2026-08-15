import { useState } from 'react';
import { Link } from 'react-router';
import { API_URL } from '../api.js';
import { LOGO_DATA_URI } from '../assets.js';

const AU_STATES = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

export default function Signup() {
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', password: '',
    regNumber: '', regState: 'VIC',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null); // success message once submitted

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/vet-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not submit application');
      setDone(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div style={styles.wrap}>
        <img src={LOGO_DATA_URI} alt="Goodbye Mate" style={styles.logo} />
        <div style={styles.form}>
          <p style={styles.subtitle}>Application received</p>
          <p style={styles.doneText}>{done}</p>
          <Link to="/login" style={styles.link}>Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <img src={LOGO_DATA_URI} alt="Goodbye Mate" style={styles.logo} />
      <form onSubmit={onSubmit} style={styles.form}>
        <p style={styles.subtitle}>Vet application</p>
        <p style={styles.intro}>
          A few details to get started — you'll fill in the rest (address, territory, bank details) on your profile once you're approved.
        </p>
        {error && <p style={styles.error}>{error}</p>}

        <label style={styles.label}>
          Full name
          <input value={form.fullName} onChange={set('fullName')} required style={styles.input} autoFocus />
        </label>
        <label style={styles.label}>
          Email
          <input type="email" inputMode="email" autoComplete="username" value={form.email} onChange={set('email')} required style={styles.input} />
        </label>
        <label style={styles.label}>
          Phone
          <input type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} required style={styles.input} />
        </label>
        <label style={styles.label}>
          Password
          <input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={8} style={styles.input} />
        </label>

        <div style={styles.row}>
          <label style={{ ...styles.label, flex: 1 }}>
            Registration number
            <input value={form.regNumber} onChange={set('regNumber')} required style={styles.input} />
          </label>
          <label style={{ ...styles.label, flex: 1 }}>
            Registration state
            <select value={form.regState} onChange={set('regState')} style={styles.input}>
              {AU_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <button type="submit" disabled={submitting} style={styles.button}>
          {submitting ? 'Submitting…' : 'Submit application'}
        </button>
        <Link to="/login" style={styles.link}>Already approved? Sign in</Link>
      </form>
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', minHeight: '100dvh', alignItems: 'center', justifyContent: 'center', background: 'var(--gm-forest)', padding: 24 },
  logo: { width: 200, height: 'auto', marginTop: 12, marginBottom: 20 },
  form: { width: '100%', maxWidth: 380, padding: '28px 24px 32px', background: '#fff', borderRadius: 14 },
  subtitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--gm-ink-soft)', marginBottom: 10, fontWeight: 600 },
  intro: { fontSize: 13, color: 'var(--gm-ink-soft)', marginBottom: 18, lineHeight: 1.5 },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 14 },
  row: { display: 'flex', gap: 12 },
  input: { display: 'block', width: '100%', marginTop: 6, padding: '11px 12px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 16 },
  button: { width: '100%', padding: '13px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 15, fontWeight: 500, marginTop: 6 },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 14 },
  doneText: { fontSize: 14, color: 'var(--gm-ink)', lineHeight: 1.6, marginBottom: 20 },
  link: { display: 'block', textAlign: 'center', fontSize: 13, color: 'var(--gm-forest)', marginTop: 16, textDecoration: 'none', fontWeight: 500 },
};
