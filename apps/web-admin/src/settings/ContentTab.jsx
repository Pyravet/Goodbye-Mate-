import { useEffect, useState } from 'react';
import { fetchContent, saveContent, fetchBrochurePdf, uploadBrochurePdf, removeBrochurePdf } from './settingsApi.js';

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

      <Card title="Brochure PDFs">
        <p style={{ ...styles.hint, marginBottom: 14 }}>
          Optional — attach an actual PDF brochure for each cremation option. If uploaded, clients see a
          download link on their journey page alongside the text above.
        </p>
        <BrochureUploader kind="private_cremation" label="Private cremation brochure" />
        <BrochureUploader kind="communal_cremation" label="Communal cremation brochure" />
      </Card>

      <button onClick={onSave} disabled={saving} style={styles.saveBtn}>{saving ? 'Saving…' : saved ? 'Saved' : 'Save content'}</button>
    </div>
  );
}

function BrochureUploader({ kind, label }) {
  const [doc, setDoc] = useState(undefined); // undefined = loading, null = none, object = present
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    fetchBrochurePdf(kind).then(setDoc).catch(() => setDoc(null));
  };
  useEffect(load, [kind]);

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same filename later
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError('Please choose a PDF file.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await uploadBrochurePdf(kind, file);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await removeBrochurePdf(kind);
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.brochureRow}>
      <div style={styles.brochureLabel}>{label}</div>
      {doc === undefined ? (
        <span style={styles.hint}>Loading…</span>
      ) : doc ? (
        <div style={styles.brochureCurrent}>
          <span className="gm-badge gm-badge--forest">📄 {doc.filename}</span>
          <button onClick={onRemove} disabled={busy} style={styles.brochureRemoveBtn}>Remove</button>
        </div>
      ) : (
        <label style={styles.brochureUploadBtn}>
          {busy ? 'Uploading…' : 'Upload PDF'}
          <input type="file" accept="application/pdf" onChange={onFileChange} disabled={busy} style={{ display: 'none' }} />
        </label>
      )}
      {error && <p style={{ ...styles.hint, color: 'var(--gm-brick)' }}>{error}</p>}
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
  brochureRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--gm-line-soft)' },
  brochureLabel: { fontSize: 13, fontWeight: 500 },
  brochureCurrent: { display: 'flex', alignItems: 'center', gap: 10 },
  brochureRemoveBtn: { background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '4px 10px', fontSize: 11, color: 'var(--gm-brick)' },
  brochureUploadBtn: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
};
