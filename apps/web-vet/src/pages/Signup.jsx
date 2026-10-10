import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { API_URL } from '../api.js';
import { LOGO_DATA_URI } from '../assets.js';

const AU_STATES = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

const PARTNER_TYPES = [
  ['clinic', 'Veterinary clinic / hospital'],
  ['funeral_home', 'Funeral home'],
  ['pet_store', 'Pet store'],
  ['other', 'Other'],
];

/**
 * Sign-up starts by asking who is applying. Vets and referring partners
 * (hospitals, funeral homes, pet stores) are different accounts with
 * different details and different approval, so asking first sends each
 * to the right form instead of everyone landing on the vet application.
 */
export default function Signup() {
  const [params] = useSearchParams();
  const initial = params.get('as') === 'partner' ? 'partner' : params.get('as') === 'vet' ? 'vet' : null;
  const [kind, setKind] = useState(initial);

  if (!kind) {
    return (
      <div style={styles.wrap}>
        <img src={LOGO_DATA_URI} alt="Goodbye Mate" style={styles.logo} />
        <div style={styles.form}>
          <p style={styles.subtitle}>Create an account</p>
          <p style={styles.intro}>Which best describes you?</p>
          <button type="button" onClick={() => setKind('vet')} style={styles.choice}>
            <strong>I&rsquo;m a veterinarian</strong>
            <span style={styles.choiceHint}>Apply to do at-home visits with Goodbye Mate.</span>
          </button>
          <button type="button" onClick={() => setKind('partner')} style={styles.choice}>
            <strong>I&rsquo;m a referring partner</strong>
            <span style={styles.choiceHint}>A hospital, clinic, funeral home or pet store that refers families to us.</span>
          </button>
          <Link to="/login" style={styles.link}>Already approved? Sign in</Link>
        </div>
      </div>
    );
  }
  return kind === 'partner' ? <PartnerSignup onBack={() => setKind(null)} /> : <VetSignup onBack={() => setKind(null)} />;
}

function PartnerSignup({ onBack }) {
  const [form, setForm] = useState({
    businessName: '', partnerType: 'clinic', contactName: '', email: '', phone: '',
    password: '', abn: '', suburb: '', postcode: '', state: 'VIC',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/partner-signup`, {
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
        <p style={styles.subtitle}>Referring partner application</p>
        <p style={styles.intro}>
          Tell us about your business. Once approved you can send referrals and see what became of each one.
        </p>
        {error && <p style={styles.error}>{error}</p>}
        <label style={styles.label}>
          Business name
          <input value={form.businessName} onChange={set('businessName')} required style={styles.input} autoFocus />
        </label>
        <label style={styles.label}>
          Type of business
          <select value={form.partnerType} onChange={set('partnerType')} style={styles.input}>
            {PARTNER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label style={styles.label}>
          ABN (optional)
          <input value={form.abn} onChange={set('abn')} style={styles.input} />
        </label>
        <label style={styles.label}>
          Your name
          <input value={form.contactName} onChange={set('contactName')} required style={styles.input} />
        </label>
        <label style={styles.label}>
          Email
          <input type="email" inputMode="email" autoComplete="username" value={form.email} onChange={set('email')} required style={styles.input} />
        </label>
        <label style={styles.label}>
          Phone
          <input type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} required style={styles.input} />
        </label>
        <div style={styles.row}>
          <label style={{ ...styles.label, flex: 2 }}>
            Suburb
            <input value={form.suburb} onChange={set('suburb')} style={styles.input} />
          </label>
          <label style={{ ...styles.label, flex: 1 }}>
            Postcode
            <input value={form.postcode} onChange={set('postcode')} inputMode="numeric" style={styles.input} />
          </label>
        </div>
        <label style={styles.label}>
          Password
          <input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={8} style={styles.input} />
        </label>
        <button type="submit" disabled={submitting} style={styles.button}>
          {submitting ? 'Submitting…' : 'Submit application'}
        </button>
        <button type="button" onClick={onBack} style={styles.backBtn}>&larr; Back</button>
      </form>
    </div>
  );
}

function VetSignup({ onBack }) {
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
        <button type="button" onClick={onBack} style={styles.backBtn}>&larr; Back</button>
        <Link to="/login" style={styles.link}>Already approved? Sign in</Link>
      </form>
    </div>
  );
}

const styles = {
  choice: { display: 'flex', flexDirection: 'column', gap: 4, width: '100%', textAlign: 'left', padding: '14px 16px', marginBottom: 12, background: '#fff', border: '2px solid var(--gm-forest)', borderRadius: 'var(--gm-radius-sm)', fontSize: 16, color: 'var(--gm-ink)', cursor: 'pointer' },
  choiceHint: { fontSize: 13, color: 'var(--gm-ink-soft)', lineHeight: 1.4 },
  backBtn: { display: 'block', width: '100%', marginTop: 12, background: 'none', border: 'none', color: 'var(--gm-ink-soft)', fontSize: 13, cursor: 'pointer' },
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
