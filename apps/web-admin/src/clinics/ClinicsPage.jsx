import { useState, useEffect, useCallback } from 'react';
import AppShell from '../layout/AppShell.jsx';
import {
  fetchClinics, createClinic, updateClinic, setClinicActive,
  fetchClinicUsers, createClinicUser,
} from './clinicsApi.js';

const EMPTY = {
  name: '', phone: '', email: '', address: '',
  suburb: '', postcode: '', state: 'NSW', abn: '', notes: '',
};

/**
 * Vet clinic partners.
 *
 * Clinics refer clients and can see what became of each referral. No
 * commission is paid yet — that model is still undecided — but every
 * referral is attributed from day one, so the numbers are real when the
 * decision is made.
 */
export default function ClinicsPage() {
  const [clinics, setClinics] = useState(null);
  const [selected, setSelected] = useState(null); // clinic object, or 'new'
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchClinics().then(setClinics).catch((e) => { setError(e.message); setClinics([]); });
  }, []);

  useEffect(() => { load(); }, [load]);

  if (selected) {
    return (
      <AppShell>
        <div style={styles.page}>
          <ClinicDetail
            clinic={selected === 'new' ? null : selected}
            onClose={() => { setSelected(null); load(); }}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={styles.page}>
        <div style={styles.head}>
          <h1 style={styles.title}>Clinic partners</h1>
          <button onClick={() => setSelected('new')} style={styles.newBtn}>+ Add a clinic</button>
        </div>
        <p style={styles.subtitle}>
          Vet clinics who refer clients. They get a login to submit referrals and follow what
          happened to each one. Referrals land in your Requests inbox like any other enquiry.
        </p>

        {error && <p style={styles.error}>{error}</p>}

        {!clinics ? (
          <p style={styles.empty}>Loading…</p>
        ) : clinics.length === 0 ? (
          <p style={styles.empty}>No clinics yet.</p>
        ) : (
          clinics.map((c) => (
            <div key={c.id} className="gm-card" style={{ ...styles.row, ...(c.is_active ? {} : styles.rowOff) }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.name}>
                  {c.name}
                  {!c.is_active && <span style={styles.inactive}> · inactive</span>}
                </div>
                <div style={styles.meta}>
                  {[c.suburb, c.state].filter(Boolean).join(' ') || 'No address'}
                  {c.phone && ` · ${c.phone}`}
                </div>
                <div style={styles.stats}>
                  {c.referral_count} referral{c.referral_count === 1 ? '' : 's'}
                  {' · '}{c.job_count} became job{c.job_count === 1 ? '' : 's'}
                  {' · '}{c.user_count} login{c.user_count === 1 ? '' : 's'}
                  {c.user_count === 0 && (
                    <strong style={styles.warn}> — no login yet, they can&apos;t sign in</strong>
                  )}
                </div>
              </div>
              <button onClick={() => setSelected(c)} style={styles.openBtn}>Open</button>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}

function ClinicDetail({ clinic, onClose }) {
  const [form, setForm] = useState(clinic ? { ...EMPTY, ...stripNulls(clinic) } : EMPTY);
  const [users, setUsers] = useState(null);
  const [newUser, setNewUser] = useState({ fullName: '', email: '', password: '' });
  const [createdLogin, setCreatedLogin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const loadUsers = useCallback(() => {
    if (!clinic) return;
    fetchClinicUsers(clinic.id).then(setUsers).catch(() => setUsers([]));
  }, [clinic]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false); };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (clinic) await updateClinic(clinic.id, form);
      else { await createClinic(form); onClose(); return; }
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addLogin = async () => {
    setBusy(true);
    setError('');
    try {
      const user = await createClinicUser(clinic.id, newUser);
      // Shown once, with the password, because it isn't emailed — email
      // delivery isn't proven, and a login that silently never arrives
      // is worse than one read out over the phone.
      setCreatedLogin({ ...user, password: newUser.password });
      setNewUser({ fullName: '', email: '', password: '' });
      loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={onClose} style={styles.back}>← All clinics</button>
      <h1 style={styles.title}>{clinic ? clinic.name : 'New clinic'}</h1>

      {error && <p style={styles.error}>{error}</p>}
      {saved && <p style={styles.saved}>Saved.</p>}

      <div className="gm-card" style={styles.card}>
        <h3 style={styles.cardTitle}>Clinic details</h3>
        <Field label="Clinic name"><input value={form.name} onChange={set('name')} style={styles.input} /></Field>
        <div style={styles.formRow}>
          <Field label="Phone"><input value={form.phone} onChange={set('phone')} style={styles.input} /></Field>
          <Field label="Email"><input type="email" value={form.email} onChange={set('email')} style={styles.input} /></Field>
        </div>
        <Field label="Address"><input value={form.address} onChange={set('address')} style={styles.input} /></Field>
        <div style={styles.formRow}>
          <Field label="Suburb"><input value={form.suburb} onChange={set('suburb')} style={styles.input} /></Field>
          <Field label="Postcode"><input value={form.postcode} onChange={set('postcode')} style={styles.input} /></Field>
          <Field label="State">
            <select value={form.state} onChange={set('state')} style={styles.input}>
              {['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="ABN"><input value={form.abn} onChange={set('abn')} style={styles.input} /></Field>
        <Field label="Notes (internal)">
          <textarea value={form.notes} onChange={set('notes')} rows={2} style={styles.input} />
        </Field>
        <button onClick={save} disabled={busy || !form.name.trim()} style={styles.saveBtn}>
          {busy ? 'Saving…' : clinic ? 'Save changes' : 'Add clinic'}
        </button>
      </div>

      {clinic && (
        <>
          <div className="gm-card" style={styles.card}>
            <h3 style={styles.cardTitle}>Logins</h3>
            <p style={styles.hint}>
              Each person at the clinic who submits referrals needs their own login. Passwords
              are not emailed — set one here and pass it on directly.
            </p>

            {createdLogin && (
              <div style={styles.credBox}>
                <strong>Login created.</strong> Give these to {createdLogin.full_name} now — the
                password can&apos;t be shown again.
                <div style={styles.cred}>{createdLogin.email}</div>
                <div style={styles.cred}>{createdLogin.password}</div>
                <button onClick={() => setCreatedLogin(null)} style={styles.smallBtn}>Done</button>
              </div>
            )}

            {users === null ? (
              <p style={styles.hint}>Loading…</p>
            ) : users.length === 0 ? (
              <p style={styles.hint}>No logins yet — this clinic can&apos;t sign in.</p>
            ) : (
              users.map((u) => (
                <div key={u.id} style={styles.userRow}>
                  <span>{u.full_name}</span>
                  <span style={styles.userEmail}>{u.email}</span>
                </div>
              ))
            )}

            <div style={styles.formRow}>
              <Field label="Name">
                <input value={newUser.fullName} onChange={(e) => setNewUser((u) => ({ ...u, fullName: e.target.value }))} style={styles.input} />
              </Field>
              <Field label="Email">
                <input type="email" value={newUser.email} onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))} style={styles.input} />
              </Field>
            </div>
            <Field label="Password (at least 10 characters)">
              <input value={newUser.password} onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))} style={styles.input} />
            </Field>
            <button
              onClick={addLogin}
              disabled={busy || !newUser.fullName || !newUser.email || newUser.password.length < 10}
              style={styles.secondaryBtn}
            >
              Create login
            </button>
          </div>

          <div className="gm-card" style={styles.card}>
            <h3 style={styles.cardTitle}>Status</h3>
            <p style={styles.hint}>
              Deactivating stops the clinic signing in or submitting referrals. Past referrals
              stay attributed to them — the record of where a job came from shouldn&apos;t
              disappear because a partnership ended.
            </p>
            <button
              onClick={async () => {
                setBusy(true);
                try { await setClinicActive(clinic.id, !clinic.is_active); onClose(); }
                catch (err) { setError(err.message); setBusy(false); }
              }}
              style={clinic.is_active ? styles.dangerBtn : styles.secondaryBtn}
            >
              {clinic.is_active ? 'Deactivate this clinic' : 'Reactivate this clinic'}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** Nulls from the API would render as the string "null" in inputs. */
function stripNulls(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v ?? '']));
}

function Field({ label, children }) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      {children}
    </label>
  );
}

const styles = {
  page: { padding: '24px 28px', maxWidth: 720 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, marginBottom: 4 },
  subtitle: { fontSize: 13, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 18 },
  back: { background: 'none', border: 'none', color: 'var(--gm-ink-soft)', fontSize: 13, marginBottom: 10, padding: 0 },
  newBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '9px 16px', fontSize: 13, fontWeight: 500 },
  error: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 12 },
  saved: { fontSize: 13, color: 'var(--gm-forest)', marginBottom: 12 },
  empty: { fontSize: 13, color: 'var(--gm-ink-soft)' },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8 },
  rowOff: { opacity: 0.55 },
  name: { fontSize: 15, fontWeight: 600 },
  inactive: { fontSize: 12, color: 'var(--gm-ink-soft)', fontWeight: 400 },
  meta: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  stats: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 4 },
  warn: { color: 'var(--gm-brick)' },
  openBtn: { background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '6px 14px', fontSize: 12, flexShrink: 0 },
  card: { padding: 16, marginBottom: 12 },
  cardTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 15, fontWeight: 600, marginBottom: 10 },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 12 },
  field: { display: 'block', flex: 1, minWidth: 0, marginBottom: 10 },
  label: { display: 'block', fontSize: 11, color: 'var(--gm-ink-soft)', marginBottom: 3 },
  input: { width: '100%', padding: '9px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, fontFamily: 'inherit', background: '#fff' },
  formRow: { display: 'flex', gap: 8 },
  saveBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '10px 20px', fontSize: 14, fontWeight: 500 },
  secondaryBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '10px 20px', fontSize: 14 },
  dangerBtn: { background: '#fff', color: 'var(--gm-brick)', border: '1px solid var(--gm-brick)', borderRadius: 'var(--gm-radius-sm)', padding: '10px 20px', fontSize: 14 },
  smallBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '6px 14px', fontSize: 12, marginTop: 8 },
  userRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '7px 0', borderBottom: '1px solid var(--gm-line-soft)' },
  userEmail: { color: 'var(--gm-ink-soft)', fontSize: 12 },
  credBox: { background: 'var(--gm-honey-soft)', color: '#7A5A22', padding: '12px 14px', borderRadius: 'var(--gm-radius-sm)', marginBottom: 12, fontSize: 13, lineHeight: 1.6 },
  cred: { fontFamily: 'monospace', fontSize: 14, marginTop: 4, color: 'var(--gm-ink)' },
};
