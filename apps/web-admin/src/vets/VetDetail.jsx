import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import AppShell from '../layout/AppShell.jsx';
import TerritoryMap from '../maps/TerritoryMap.jsx';
import WeeklyAvailabilityGrid from './WeeklyAvailabilityGrid.jsx';
import { fetchVet, fetchTerritory, updateVetProfile } from './vetsApi.js';

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'availability', label: 'Availability' },
  { key: 'territory', label: 'Territory' },
];

export default function VetDetail() {
  const { id } = useParams();
  const [vet, setVet] = useState(null);
  const [territory, setTerritory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('profile');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchVet(id), fetchTerritory(id).catch(() => null)])
      .then(([v, t]) => { setVet(v); setTerritory(t); })
      .catch(() => setVet(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <AppShell><div style={styles.page}>Loading…</div></AppShell>;
  if (!vet) return <AppShell><div style={styles.page}>Vet not found.</div></AppShell>;

  return (
    <AppShell>
      <div style={styles.page}>
        <Link to="/vets" style={styles.back}>← All vets</Link>

        <div style={styles.headerRow}>
          <div style={{ ...styles.colorDot, background: vet.color }} />
          <div>
            <h1 style={styles.title}>{vet.full_name}</h1>
            <p style={styles.subtitle}>{vet.email} · {vet.phone}</p>
          </div>
        </div>

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

        {tab === 'profile' && <ProfileTab vet={vet} onSaved={load} />}
        {tab === 'availability' && <WeeklyAvailabilityGrid vetId={id} initialHours={vet.weekly_hours} />}
        {tab === 'territory' && <TerritoryMap vetId={id} initialGeoJSON={territory} />}
      </div>
    </AppShell>
  );
}

function ProfileTab({ vet, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [postcodesInput, setPostcodesInput] = useState((vet.postcodes || []).join(', '));
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
    try {
      const postcodes = postcodesInput.split(',').map((p) => p.trim()).filter(Boolean);
      await updateVetProfile(vet.id, { ...form, postcodes });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="gm-card" style={{ padding: 20, maxWidth: 480 }}>
      <Field label="Registration number"><input value={form.regNumber} onChange={set('regNumber')} style={styles.input} /></Field>
      <Field label="Registration state">
        <select value={form.regState} onChange={set('regState')} style={styles.input}>
          {['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="ABN"><input value={form.abn} onChange={set('abn')} style={styles.input} /></Field>
      <Field label="GST registered">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={form.isGstRegistered} onChange={set('isGstRegistered')} /> Yes
        </label>
      </Field>
      <Field label="Territory postcodes (fallback list)">
        <input value={postcodesInput} onChange={(e) => setPostcodesInput(e.target.value)} style={styles.input} />
      </Field>
      <button onClick={onSave} disabled={saving} style={styles.saveBtn}>{saving ? 'Saving…' : 'Save changes'}</button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 14 }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}

const styles = {
  page: { padding: '32px 40px', maxWidth: 720 },
  back: { fontSize: 13, color: 'var(--gm-ink-soft)', textDecoration: 'none' },
  headerRow: { display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0 20px' },
  colorDot: { width: 16, height: 16, borderRadius: '50%', flexShrink: 0 },
  title: { fontSize: 24 },
  subtitle: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 2 },
  tabs: { display: 'flex', gap: 4, background: 'var(--gm-line-soft)', padding: 3, borderRadius: 'var(--gm-radius-sm)', width: 'fit-content', marginBottom: 20 },
  tab: { background: 'none', border: 'none', padding: '6px 14px', borderRadius: 5, fontSize: 13, fontWeight: 500, color: 'var(--gm-ink-soft)' },
  tabActive: { background: '#fff', color: 'var(--gm-forest-dark)', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' },
  input: { width: '100%', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, background: '#fff' },
  saveBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500, marginTop: 4 },
};
