import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import AppShell from '../layout/AppShell.jsx';
import TerritoryMap from '../maps/TerritoryMap.jsx';
import WeeklyAvailabilityGrid from './WeeklyAvailabilityGrid.jsx';
import { fetchVet, fetchTerritory, updateVetProfile, approveVet, deactivateVet } from './vetsApi.js';

const AU_STATES = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'availability', label: 'Availability' },
  { key: 'territory', label: 'Territory' },
];

export default function VetDetail() {
  const { id } = useParams();
  const [vet, setVet] = useState(null);
  const [bankDetails, setBankDetails] = useState(null);
  const [territory, setTerritory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('profile');
  const [statusBusy, setStatusBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchVet(id), fetchTerritory(id).catch(() => null)])
      .then(([data, t]) => { setVet(data.vet); setBankDetails(data.bankDetails); setTerritory(t); })
      .catch(() => setVet(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const onApprove = async () => { setStatusBusy(true); try { await approveVet(id); load(); } finally { setStatusBusy(false); } };
  const onDeactivate = async () => { setStatusBusy(true); try { await deactivateVet(id); load(); } finally { setStatusBusy(false); } };

  if (loading) return <AppShell><div style={styles.page}>Loading…</div></AppShell>;
  if (!vet) return <AppShell><div style={styles.page}>Vet not found.</div></AppShell>;

  return (
    <AppShell>
      <div style={styles.page}>
        <Link to="/vets" style={styles.back}>← All vets</Link>

        <div style={styles.headerRow}>
          <div style={{ ...styles.colorDot, background: vet.color }} />
          <div style={{ flex: 1 }}>
            <h1 style={styles.title}>{vet.full_name}</h1>
            <p style={styles.subtitle}>{vet.email} · {vet.phone}</p>
          </div>
          {vet.is_active ? (
            <button onClick={onDeactivate} disabled={statusBusy} style={styles.deactivateBtn}>Deactivate</button>
          ) : (
            <button onClick={onApprove} disabled={statusBusy} style={styles.approveBtn}>{statusBusy ? 'Approving…' : 'Approve'}</button>
          )}
        </div>

        {!vet.is_active && (
          <p style={styles.pendingBanner}>This vet's account is inactive — they can't log in until approved.</p>
        )}

        <div style={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{ ...styles.tab, ...(tab === t.key ? styles.tabActive : {}) }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'profile' && <ProfileTab vet={vet} bankDetails={bankDetails} onSaved={load} />}
        {tab === 'availability' && <WeeklyAvailabilityGrid vetId={id} initialHours={vet.weekly_hours} />}
        {tab === 'territory' && <TerritoryMap vetId={id} initialGeoJSON={territory} />}
      </div>
    </AppShell>
  );
}

function ProfileTab({ vet, bankDetails, onSaved }) {
  return (
    <div style={{ maxWidth: 480 }}>
      <RegistrationCard vet={vet} onSaved={onSaved} />
      <PersonalDetailsCard vet={vet} onSaved={onSaved} />
      <TerritoryPostcodesCard vet={vet} onSaved={onSaved} />
      <BankDetailsCard vet={vet} bankDetails={bankDetails} onSaved={onSaved} />
    </div>
  );
}

function RegistrationCard({ vet, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    regNumber: vet.reg_number || '',
    regState: vet.reg_state || 'VIC',
    abn: vet.abn || '',
    isGstRegistered: vet.is_gst_registered || false,
  });
  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };
  const onSave = async () => {
    setSaving(true);
    try { await updateVetProfile(vet.id, form); onSaved(); } finally { setSaving(false); }
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Registration &amp; ABN</h3>
      <Field label="Registration number"><input value={form.regNumber} onChange={set('regNumber')} style={styles.input} /></Field>
      <Field label="Registration state">
        <select value={form.regState} onChange={set('regState')} style={styles.input}>
          {AU_STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="ABN"><input value={form.abn} onChange={set('abn')} style={styles.input} /></Field>
      <Field label="GST registered">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={form.isGstRegistered} onChange={set('isGstRegistered')} /> Yes
        </label>
      </Field>
      <button onClick={onSave} disabled={saving} style={styles.saveBtn}>{saving ? 'Saving…' : 'Save changes'}</button>
    </div>
  );
}

function PersonalDetailsCard({ vet, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    phone: vet.phone || '',
    address: vet.address || '',
    suburb: vet.suburb || '',
    postcode: vet.postcode || '',
    state: vet.state || 'VIC',
  });
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const onSave = async () => {
    setSaving(true);
    try { await updateVetProfile(vet.id, form); onSaved(); } finally { setSaving(false); }
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Personal details</h3>
      <Field label="Phone"><input value={form.phone} onChange={set('phone')} style={styles.input} /></Field>
      <Field label="Address"><input value={form.address} onChange={set('address')} style={styles.input} /></Field>
      <div style={{ display: 'flex', gap: 12 }}>
        <Field label="Suburb"><input value={form.suburb} onChange={set('suburb')} style={styles.input} /></Field>
        <Field label="Postcode"><input value={form.postcode} onChange={set('postcode')} style={styles.input} /></Field>
      </div>
      <Field label="State">
        <select value={form.state} onChange={set('state')} style={styles.input}>
          {AU_STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
      <button onClick={onSave} disabled={saving} style={styles.saveBtn}>{saving ? 'Saving…' : 'Save changes'}</button>
    </div>
  );
}

function TerritoryPostcodesCard({ vet, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [postcodesInput, setPostcodesInput] = useState((vet.postcodes || []).join(', '));
  const onSave = async () => {
    setSaving(true);
    try {
      const postcodes = postcodesInput.split(',').map((p) => p.trim()).filter(Boolean);
      await updateVetProfile(vet.id, { postcodes });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Territory (fallback postcodes)</h3>
      <p style={styles.cardBody}>For an exact coverage area, use the Territory tab to draw it on the map instead.</p>
      <Field label="Postcodes (comma-separated)">
        <input value={postcodesInput} onChange={(e) => setPostcodesInput(e.target.value)} style={styles.input} />
      </Field>
      <button onClick={onSave} disabled={saving} style={styles.saveBtn}>{saving ? 'Saving…' : 'Save changes'}</button>
    </div>
  );
}

function BankDetailsCard({ vet, bankDetails, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ bankAccountName: '', bankBsb: '', bankAccountNumber: '' });
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const onSave = async () => {
    setSaving(true);
    try {
      await updateVetProfile(vet.id, form);
      setForm({ bankAccountName: '', bankBsb: '', bankAccountNumber: '' });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Bank details (for payouts)</h3>
      {bankDetails?.hasBankDetails ? (
        <p style={styles.cardBody}>
          On file: {bankDetails.accountName || 'account'} · BSB {bankDetails.bsb} · Acc {bankDetails.accountNumber}
        </p>
      ) : (
        <p style={styles.cardBody}>No bank details on file yet — the vet can add these from their own profile, or enter them here.</p>
      )}
      <Field label="Account name"><input value={form.bankAccountName} onChange={set('bankAccountName')} placeholder="Leave blank to keep current" style={styles.input} /></Field>
      <div style={{ display: 'flex', gap: 12 }}>
        <Field label="BSB"><input value={form.bankBsb} onChange={set('bankBsb')} placeholder="123-456" style={styles.input} /></Field>
        <Field label="Account number"><input value={form.bankAccountNumber} onChange={set('bankAccountNumber')} placeholder="12345678" style={styles.input} /></Field>
      </div>
      <button onClick={onSave} disabled={saving} style={styles.saveBtn}>{saving ? 'Saving…' : 'Update bank details'}</button>
      <p style={styles.hint}>Encrypted before storage — only masked digits are ever shown again.</p>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', flex: 1, fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 14 }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}

const styles = {
  page: { padding: '32px 40px', maxWidth: 720 },
  back: { fontSize: 13, color: 'var(--gm-ink-soft)', textDecoration: 'none' },
  headerRow: { display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0 8px' },
  colorDot: { width: 16, height: 16, borderRadius: '50%', flexShrink: 0 },
  title: { fontSize: 24 },
  subtitle: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 2 },
  approveBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500, flexShrink: 0 },
  deactivateBtn: { background: '#fff', color: 'var(--gm-brick)', border: '1px solid var(--gm-line)', padding: '8px 16px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500, flexShrink: 0 },
  pendingBanner: { fontSize: 13, color: '#7A5A22', background: 'var(--gm-honey-soft)', borderRadius: 'var(--gm-radius-sm)', padding: '10px 14px', marginBottom: 16 },
  tabs: { display: 'flex', gap: 4, background: 'var(--gm-line-soft)', padding: 3, borderRadius: 'var(--gm-radius-sm)', width: 'fit-content', marginBottom: 20 },
  tab: { background: 'none', border: 'none', padding: '6px 14px', borderRadius: 5, fontSize: 13, fontWeight: 500, color: 'var(--gm-ink-soft)' },
  tabActive: { background: '#fff', color: 'var(--gm-forest-dark)', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' },
  card: { padding: 20, marginBottom: 16 },
  cardTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginBottom: 12, fontFamily: 'var(--gm-font-body)', fontWeight: 600 },
  cardBody: { fontSize: 13, color: 'var(--gm-ink-soft)', marginBottom: 12 },
  input: { width: '100%', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, background: '#fff' },
  saveBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500, marginTop: 4 },
  hint: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 10, fontStyle: 'italic' },
};
