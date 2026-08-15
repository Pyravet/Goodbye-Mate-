import { useEffect, useState } from 'react';
import { fetchTemplates, saveTemplate } from './settingsApi.js';

export default function TemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);

  useEffect(() => {
    fetchTemplates().then(setTemplates).catch(() => setTemplates([])).finally(() => setLoading(false));
  }, []);

  const updateText = (id, text) => {
    setTemplates((ts) => ts.map((t) => (t.id === id ? { ...t, text } : t)));
    setSavedId(null);
  };

  const onSave = async (t) => {
    setSavingId(t.id);
    try {
      await saveTemplate(t.id, { label: t.label, text: t.text });
      setSavedId(t.id);
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <p style={{ color: 'var(--gm-ink-soft)', fontSize: 13 }}>Loading…</p>;

  return (
    <div>
      <p style={styles.hint}>
        These are the message templates used when sending SMS, WhatsApp, or email updates to clients.
        Placeholders like {'{clientName}'}, {'{petName}'}, {'{date}'}, {'{time}'}, {'{vetName}'} are filled in automatically.
      </p>
      {templates.map((t) => (
        <div key={t.id} className="gm-card" style={styles.card}>
          <div style={styles.cardHeader}>{t.label}</div>
          <textarea
            value={t.text}
            onChange={(e) => updateText(t.id, e.target.value)}
            rows={2}
            style={styles.textarea}
          />
          <button onClick={() => onSave(t)} disabled={savingId === t.id} style={styles.saveBtn}>
            {savingId === t.id ? 'Saving…' : savedId === t.id ? 'Saved' : 'Save'}
          </button>
        </div>
      ))}
    </div>
  );
}

const styles = {
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 16, fontStyle: 'italic' },
  card: { padding: 16, marginBottom: 10 },
  cardHeader: { fontFamily: 'var(--gm-font-display)', fontSize: 15, fontWeight: 600, marginBottom: 8 },
  textarea: { width: '100%', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', marginBottom: 10 },
  saveBtn: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '6px 14px', fontSize: 12, fontWeight: 500 },
};
