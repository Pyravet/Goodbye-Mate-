import { useState, useEffect } from 'react';
import { fetchNoteTemplates, addNoteTemplate, removeNoteTemplate } from './vetsApi.js';

/**
 * Saved snippets for medical notes.
 *
 * The backend for this shipped long ago and had NO UI, so the feature
 * existed and was unreachable. It's worth having: medical notes are
 * append-only and written at someone's home, often on a phone, often
 * straight after a difficult visit. Typing the same procedural paragraph
 * each time is where detail gets dropped.
 */
export default function NoteTemplatesCard({ vetId }) {
  const [templates, setTemplates] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => fetchNoteTemplates(vetId).then(setTemplates).catch(() => setTemplates([]));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [vetId]);

  const save = async () => {
    if (!form.label.trim() || !form.text.trim()) {
      setError('Both a name and the text are needed.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await addNoteTemplate(vetId, { label: form.label.trim(), text: form.text.trim() });
      setForm({ label: '', text: '' });
      setAdding(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id, label) => {
    if (!window.confirm(`Remove "${label}"?`)) return;
    try {
      await removeNoteTemplate(vetId, id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Note templates</h3>
      <p style={styles.hint}>
        Snippets you can drop into medical notes. Useful for the procedural wording you write
        every time — notes are often typed on a phone straight after a hard visit, which is
        where detail gets lost.
      </p>

      {error && <p style={styles.error}>{error}</p>}

      {templates === null ? (
        <p style={styles.hint}>Loading…</p>
      ) : templates.length === 0 ? (
        <p style={styles.hint}>No templates saved yet.</p>
      ) : (
        templates.map((t) => (
          <div key={t.id} style={styles.row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.label}>{t.label}</div>
              <div style={styles.text}>{t.text}</div>
            </div>
            <button onClick={() => remove(t.id, t.label)} style={styles.remove}>Remove</button>
          </div>
        ))
      )}

      {!adding ? (
        <button onClick={() => setAdding(true)} style={styles.addBtn}>+ Add a template</button>
      ) : (
        <div style={styles.form}>
          <label style={styles.fieldLabel}>
            Name
            <input
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="e.g. Standard sedation"
              style={styles.input}
            />
          </label>
          <label style={styles.fieldLabel}>
            Text
            <textarea
              value={form.text}
              onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
              rows={4}
              placeholder="e.g. Sedation with medetomidine/butorphanol IM, followed by IV pentobarbitone via cephalic catheter. Death confirmed by absence of heartbeat and respiration."
              style={styles.input}
            />
          </label>
          <div style={styles.actions}>
            <button onClick={() => { setAdding(false); setError(''); }} style={styles.cancelBtn}>Cancel</button>
            <button onClick={save} disabled={busy} style={styles.saveBtn}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  card: { padding: 16, marginBottom: 14 },
  cardTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 16, fontWeight: 600, marginBottom: 8 },
  hint: { fontSize: 13, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 12 },
  error: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 10 },
  row: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--gm-line-soft)' },
  label: { fontSize: 14, fontWeight: 500 },
  text: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2, lineHeight: 1.5 },
  remove: { background: 'none', border: 'none', color: 'var(--gm-brick)', fontSize: 12, textDecoration: 'underline', flexShrink: 0, minHeight: 44 },
  addBtn: { width: '100%', background: '#fff', color: 'var(--gm-forest)', border: '1px solid var(--gm-forest)', borderRadius: 'var(--gm-radius-sm)', padding: '11px 0', fontSize: 14, fontWeight: 500, marginTop: 12, minHeight: 44 },
  form: { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--gm-line)' },
  fieldLabel: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 10 },
  input: { width: '100%', padding: '11px 12px', marginTop: 4, borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 15, fontFamily: 'inherit', background: '#fff', resize: 'vertical' },
  actions: { display: 'flex', gap: 8 },
  cancelBtn: { flex: 1, background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '11px 0', fontSize: 14, minHeight: 44 },
  saveBtn: { flex: 1, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '11px 0', fontSize: 14, fontWeight: 500, minHeight: 44 },
};
