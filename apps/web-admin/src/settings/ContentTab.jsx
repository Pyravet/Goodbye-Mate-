import { useEffect, useState } from 'react';
import { fetchContent, saveContent } from './settingsApi.js';

const TEXT_FIELDS = [
  { key: 'consentTemplate', label: 'Consent form text' },
  { key: 'educationalIntro', label: 'Educational intro (sent ahead of visit)' },
  { key: 'noCremationNote', label: 'No cremation chosen — note' },
  { key: 'privateCremationBrochure', label: 'Private cremation brochure text' },
  { key: 'communalCremationBrochure', label: 'Communal cremation brochure text' },
];

export default function ContentTab() {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchContent().then(setContent).catch(() => setContent(null)).finally(() => setLoading(false));
  }, []);

  const onSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await saveContent(content);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const setField = (key, value) => {
    setContent((c) => ({ ...c, [key]: value }));
    setSaved(false);
  };
  const setCompanyField = (key, value) => {
    setContent((c) => ({ ...c, company: { ...c.company, [key]: value } }));
    setSaved(false);
  };

  if (loading) return <p style={{ color: 'var(--gm-ink-soft)', fontSize: 13 }}>Loading…</p>;
  if (!content) return <p style={{ color: 'var(--gm-brick)', fontSize: 13 }}>Failed to load content settings.</p>;

  return (
    <div>
      <Card title="Company details">
        <Field label="Company name"><input value={content.company.name} onChange={(e) => setCompanyField('name', e.target.value)} style={styles.input} /></Field>
        <Field label="ABN"><input value={content.company.abn} onChange={(e) => setCompanyField('abn', e.target.value)} style={styles.input} /></Field>
        <Field label="Address"><input value={content.company.address} onChange={(e) => setCompanyField('address', e.target.value)} style={styles.input} /></Field>
        <Field label="RCTI declaration (appears on every vet's tax invoice)">
          <textarea value={content.company.rctiDeclaration} onChange={(e) => setCompanyField('rctiDeclaration', e.target.value)} rows={3} style={{ ...styles.input, resize: 'vertical' }} />
        </Field>
      </Card>

      <Card title="Client-facing text">
        {TEXT_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <textarea
              value={content[f.key] || ''}
              onChange={(e) => setField(f.key, e.target.value)}
              rows={3}
              style={{ ...styles.input, resize: 'vertical' }}
            />
          </Field>
        ))}
        <p style={styles.hint}>Use placeholders like {'{petName}'}, {'{date}'}, {'{time}'}, {'{vetName}'}, {'{crematorium}'} — these get filled in automatically.</p>
      </Card>

      <button onClick={onSave} disabled={saving} style={styles.saveBtn}>{saving ? 'Saving…' : saved ? 'Saved' : 'Save content'}</button>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="gm-card" style={{ padding: 18, marginBottom: 16 }}>
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginBottom: 12, fontFamily: 'var(--gm-font-body)', fontWeight: 600 }}>{title}</h3>
      {children}
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
  input: { width: '100%', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, background: '#fff', fontFamily: 'inherit' },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', fontStyle: 'italic' },
  saveBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500 },
};
