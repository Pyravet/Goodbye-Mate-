import { useState, useEffect, useCallback } from 'react';
import AppShell from '../layout/AppShell.jsx';
import { useAuth } from '../AuthContext.jsx';
import { apiFetch } from '../api.js';
import { enablePushNotifications } from '../push.js';

const AU_STATES = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

export default function Profile() {
  const { user, logout } = useAuth();
  const [pushStatus, setPushStatus] = useState('idle'); // idle | enabling | on | error
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '' });
  const [pwStatus, setPwStatus] = useState('idle');
  const [pwError, setPwError] = useState('');

  const [vet, setVet] = useState(null);
  const [bankDetails, setBankDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    apiFetch('/vets/me')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => { setVet(data.vet); setBankDetails(data.bankDetails); })
      .catch(() => setVet(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const onEnablePush = async () => {
    setPushStatus('enabling');
    const result = await enablePushNotifications();
    setPushStatus(result.ok ? 'on' : 'error');
  };

  const onChangePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    setPwStatus('saving');
    try {
      const res = await apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify(pwForm) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to change password');
      }
      setPwStatus('saved');
      setPwForm({ currentPassword: '', newPassword: '' });
    } catch (err) {
      setPwError(err.message);
      setPwStatus('idle');
    }
  };

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Profile</h1>
        <p style={styles.name}>{user?.fullName}</p>
        <p style={styles.email}>{user?.email}</p>
        {vet && !vet.is_active && (
          <p style={styles.pendingBanner}>Your application is pending approval — an admin will activate your account soon.</p>
        )}

        {!loading && vet && (
          <>
            <PersonalDetailsCard vetId={vet.id} initial={vet} onSaved={load} />
            <RegistrationCard vetId={vet.id} initial={vet} onSaved={load} />
            <TerritoryCard vetId={vet.id} initial={vet} onSaved={load} />
            <BankDetailsCard vetId={vet.id} bankDetails={bankDetails} onSaved={load} />
          </>
        )}

        <div className="gm-card" style={styles.card}>
          <h3 style={styles.cardTitle}>Notifications</h3>
          <p style={styles.cardBody}>Get notified the moment a job is offered to you, even when the app is closed.</p>
          {pushStatus === 'on' ? (
            <p style={styles.onNote}>Push notifications are on.</p>
          ) : (
            <button onClick={onEnablePush} disabled={pushStatus === 'enabling'} style={styles.btn}>
              {pushStatus === 'enabling' ? 'Enabling…' : 'Enable push notifications'}
            </button>
          )}
          {pushStatus === 'error' && <p style={styles.errorNote}>Couldn't enable notifications — check your browser's notification permission for this app.</p>}
        </div>

        <div className="gm-card" style={styles.card}>
          <h3 style={styles.cardTitle}>Change password</h3>
          <form onSubmit={onChangePassword}>
            {pwError && <p style={styles.errorNote}>{pwError}</p>}
            <label style={styles.label}>
              Current password
              <input type="password" value={pwForm.currentPassword} onChange={(e) => setPwForm((f) => ({ ...f, currentPassword: e.target.value }))} required style={styles.input} />
            </label>
            <label style={styles.label}>
              New password
              <input type="password" value={pwForm.newPassword} onChange={(e) => setPwForm((f) => ({ ...f, newPassword: e.target.value }))} required minLength={8} style={styles.input} />
            </label>
            <button type="submit" disabled={pwStatus === 'saving'} style={styles.btn}>
              {pwStatus === 'saving' ? 'Saving…' : pwStatus === 'saved' ? 'Saved' : 'Change password'}
            </button>
          </form>
        </div>

        <button onClick={logout} style={styles.logoutBtn}>Log out</button>
      </div>
    </AppShell>
  );
}

function saveProfile(vetId, payload) {
  return apiFetch(`/vets/${vetId}/profile`, { method: 'PUT', body: JSON.stringify(payload) });
}

function PersonalDetailsCard({ vetId, initial, onSaved }) {
  const [form, setForm] = useState({
    phone: initial.phone || '',
    address: initial.address || '',
    suburb: initial.suburb || '',
    postcode: initial.postcode || '',
    state: initial.state || 'VIC',
  });
  const [status, setStatus] = useState('idle');
  const set = (f) => (e) => { setForm((s) => ({ ...s, [f]: e.target.value })); setStatus('idle'); };

  const onSave = async () => {
    setStatus('saving');
    const res = await saveProfile(vetId, form);
    setStatus(res.ok ? 'saved' : 'error');
    if (res.ok) onSaved();
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Personal details</h3>
      <label style={styles.label}>Phone<input value={form.phone} onChange={set('phone')} style={styles.input} /></label>
      <label style={styles.label}>Address<input value={form.address} onChange={set('address')} style={styles.input} /></label>
      <div style={styles.row}>
        <label style={{ ...styles.label, flex: 1 }}>Suburb<input value={form.suburb} onChange={set('suburb')} style={styles.input} /></label>
        <label style={{ ...styles.label, flex: 1 }}>Postcode<input value={form.postcode} onChange={set('postcode')} style={styles.input} /></label>
      </div>
      <label style={styles.label}>
        State
        <select value={form.state} onChange={set('state')} style={styles.input}>
          {AU_STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      <button onClick={onSave} disabled={status === 'saving'} style={styles.btn}>
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save'}
      </button>
    </div>
  );
}

function RegistrationCard({ vetId, initial, onSaved }) {
  const [form, setForm] = useState({
    regNumber: initial.reg_number || '',
    regState: initial.reg_state || 'VIC',
    abn: initial.abn || '',
    isGstRegistered: initial.is_gst_registered || false,
  });
  const [status, setStatus] = useState('idle');
  const set = (f) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((s) => ({ ...s, [f]: value }));
    setStatus('idle');
  };

  const onSave = async () => {
    setStatus('saving');
    const res = await saveProfile(vetId, form);
    setStatus(res.ok ? 'saved' : 'error');
    if (res.ok) onSaved();
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Registration &amp; ABN</h3>
      <div style={styles.row}>
        <label style={{ ...styles.label, flex: 1 }}>Reg. number<input value={form.regNumber} onChange={set('regNumber')} style={styles.input} /></label>
        <label style={{ ...styles.label, flex: 1 }}>
          Reg. state
          <select value={form.regState} onChange={set('regState')} style={styles.input}>
            {AU_STATES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <label style={styles.label}>ABN<input value={form.abn} onChange={set('abn')} style={styles.input} /></label>
      <label style={styles.checkboxRow}>
        <input type="checkbox" checked={form.isGstRegistered} onChange={set('isGstRegistered')} />
        <span>Registered for GST</span>
      </label>
      <button onClick={onSave} disabled={status === 'saving'} style={styles.btn}>
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save'}
      </button>
    </div>
  );
}

function TerritoryCard({ vetId, initial, onSaved }) {
  const [postcodesInput, setPostcodesInput] = useState((initial.postcodes || []).join(', '));
  const [status, setStatus] = useState('idle');

  const onSave = async () => {
    setStatus('saving');
    const postcodes = postcodesInput.split(',').map((p) => p.trim()).filter(Boolean);
    const res = await saveProfile(vetId, { postcodes });
    setStatus(res.ok ? 'saved' : 'error');
    if (res.ok) onSaved();
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Territory</h3>
      <p style={styles.cardBody}>
        Postcodes you cover, as a quick fallback list. For an exact coverage area drawn on a map, ask admin to set your territory in the admin dashboard.
      </p>
      <label style={styles.label}>
        Postcodes (comma-separated)
        <input value={postcodesInput} onChange={(e) => { setPostcodesInput(e.target.value); setStatus('idle'); }} placeholder="3121, 3122, 3123…" style={styles.input} />
      </label>
      <button onClick={onSave} disabled={status === 'saving'} style={styles.btn}>
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save'}
      </button>
    </div>
  );
}

function BankDetailsCard({ vetId, bankDetails, onSaved }) {
  const [form, setForm] = useState({ bankAccountName: '', bankBsb: '', bankAccountNumber: '' });
  const [status, setStatus] = useState('idle');
  const set = (f) => (e) => { setForm((s) => ({ ...s, [f]: e.target.value })); setStatus('idle'); };

  const onSave = async () => {
    setStatus('saving');
    const res = await saveProfile(vetId, form);
    if (res.ok) {
      setForm({ bankAccountName: '', bankBsb: '', bankAccountNumber: '' });
      setStatus('saved');
      onSaved();
    } else {
      setStatus('error');
    }
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Bank details (for payouts)</h3>
      {bankDetails?.hasBankDetails ? (
        <p style={styles.cardBody}>
          On file: {bankDetails.accountName || 'account'} · BSB {bankDetails.bsb} · Acc {bankDetails.accountNumber}
        </p>
      ) : (
        <p style={styles.cardBody}>No bank details on file yet.</p>
      )}
      <label style={styles.label}>Account name<input value={form.bankAccountName} onChange={set('bankAccountName')} placeholder="Leave blank to keep current" style={styles.input} /></label>
      <div style={styles.row}>
        <label style={{ ...styles.label, flex: 1 }}>BSB<input value={form.bankBsb} onChange={set('bankBsb')} placeholder="123-456" style={styles.input} /></label>
        <label style={{ ...styles.label, flex: 1 }}>Account number<input value={form.bankAccountNumber} onChange={set('bankAccountNumber')} placeholder="12345678" style={styles.input} /></label>
      </div>
      <button onClick={onSave} disabled={status === 'saving'} style={styles.btn}>
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Updated' : 'Update bank details'}
      </button>
      <p style={styles.hint}>Encrypted before storage — only masked digits are ever shown again, including to admin.</p>
    </div>
  );
}

const styles = {
  page: { padding: '20px 16px' },
  title: { fontSize: 22, marginBottom: 4 },
  name: { fontFamily: 'var(--gm-font-display)', fontSize: 17, fontWeight: 600, marginTop: 12 },
  email: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 2 },
  pendingBanner: { fontSize: 13, color: '#7A5A22', background: 'var(--gm-honey-soft)', borderRadius: 'var(--gm-radius-sm)', padding: '10px 12px', marginTop: 14 },
  card: { padding: 16, marginTop: 18 },
  cardTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginBottom: 8, fontFamily: 'var(--gm-font-body)', fontWeight: 600 },
  cardBody: { fontSize: 13, color: 'var(--gm-ink-soft)', marginBottom: 12 },
  onNote: { fontSize: 14, color: 'var(--gm-forest-dark)' },
  errorNote: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 10 },
  btn: { padding: '10px 16px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 14, fontWeight: 500 },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 12 },
  row: { display: 'flex', gap: 12 },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--gm-ink-soft)', marginBottom: 14 },
  input: { display: 'block', width: '100%', marginTop: 6, padding: '10px 11px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 15 },
  hint: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 10, fontStyle: 'italic' },
  logoutBtn: { width: '100%', marginTop: 24, padding: '12px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', background: '#fff', color: 'var(--gm-brick)', fontSize: 14, fontWeight: 500 },
};
