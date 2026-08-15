import { useState } from 'react';
import { useNavigate } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import { createVet } from './vetsApi.js';

const COLOR_OPTIONS = ['#4A6B5A', '#BE8A3C', '#9C4A3C', '#33453A', '#6B5A9C', '#3A6B8A'];

export default function NewVetForm() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const [postcodesInput, setPostcodesInput] = useState('');
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '',
    regNumber: '', regState: 'VIC', abn: '', isGstRegistered: false,
    color: COLOR_OPTIONS[0],
  });

  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const postcodes = postcodesInput.split(',').map((p) => p.trim()).filter(Boolean);
      const res = await createVet({ ...form, postcodes });
      setCreated(res); // { vet, tempPassword, loginEmail }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return (
      <AppShell>
        <div style={styles.page}>
          <div className="gm-card" style={{ padding: 24 }}>
            <h1 style={{ ...styles.title, marginBottom: 8 }}>Vet added</h1>
            <p style={{ fontSize: 14, marginBottom: 20 }}>
              Share these login details with <strong>{form.fullName}</strong> now — the password is shown only this once and can't be retrieved again.
              They can change it after signing in.
            </p>
            <div style={{ background: 'var(--gm-line-soft)', borderRadius: 'var(--gm-radius-sm)', padding: 16, marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 4 }}>Email</div>
              <div style={{ fontFamily: 'monospace', fontSize: 15, marginBottom: 12 }}>{created.loginEmail}</div>
              <div style={{ fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 4 }}>Temporary password</div>
              <div style={{ fontFamily: 'monospace', fontSize: 15 }}>{created.tempPassword}</div>
            </div>
            <button onClick={() => navigate(`/vets/${created.vet.id}`)} style={styles.submitBtn}>Continue to vet profile</button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Add a vet</h1>
        <form onSubmit={onSubmit} style={styles.form}>
          {error && <p style={styles.error}>{error}</p>}

          <Field label="Full name" required><input value={form.fullName} onChange={set('fullName')} required style={styles.input} /></Field>
          <Row>
            <Field label="Email" required><input type="email" value={form.email} onChange={set('email')} required style={styles.input} /></Field>
            <Field label="Phone" required><input value={form.phone} onChange={set('phone')} required style={styles.input} /></Field>
          </Row>

          <Row>
            <Field label="Registration number"><input value={form.regNumber} onChange={set('regNumber')} style={styles.input} /></Field>
            <Field label="Registration state">
              <select value={form.regState} onChange={set('regState')} style={styles.input}>
                {['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </Row>

          <Row>
            <Field label="ABN"><input value={form.abn} onChange={set('abn')} style={styles.input} /></Field>
            <Field label="GST registered">
              <label style={styles.checkboxRow}>
                <input type="checkbox" checked={form.isGstRegistered} onChange={set('isGstRegistered')} />
                <span>Yes, registered for GST</span>
              </label>
            </Field>
          </Row>

          <Field label="Territory postcodes (comma-separated, quick fallback — draw the real territory after saving)">
            <input value={postcodesInput} onChange={(e) => setPostcodesInput(e.target.value)} placeholder="3000, 3001, 3002…" style={styles.input} />
          </Field>

          <Field label="Calendar color">
            <div style={styles.colorRow}>
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  style={{ ...styles.colorSwatch, background: c, outline: form.color === c ? '2px solid var(--gm-ink)' : 'none', outlineOffset: 2 }}
                />
              ))}
            </div>
          </Field>

          <div style={styles.actions}>
            <button type="submit" disabled={saving} style={styles.submitBtn}>{saving ? 'Adding…' : 'Add vet'}</button>
          </div>
          <p style={styles.note}>
            You'll see the vet's temporary login password once, right after this — share it with them directly.
          </p>
        </form>
      </div>
    </AppShell>
  );
}

function Row({ children }) { return <div style={{ display: 'flex', gap: 12 }}>{children}</div>; }
function Field({ label, required, children }) {
  return (
    <label style={{ display: 'block', flex: 1, fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 14 }}>
      {label}{required && ' *'}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}

const styles = {
  page: { padding: '32px 40px', maxWidth: 600 },
  title: { fontSize: 24, marginBottom: 20 },
  form: {},
  input: { width: '100%', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, background: '#fff' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, height: 36 },
  colorRow: { display: 'flex', gap: 8 },
  colorSwatch: { width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer' },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 16 },
  actions: { marginTop: 8 },
  submitBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '11px 22px', borderRadius: 'var(--gm-radius-sm)', fontSize: 14, fontWeight: 500 },
  note: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 14, fontStyle: 'italic' },
};
