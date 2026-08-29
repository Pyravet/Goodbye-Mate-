import { useState, useEffect, useCallback } from 'react';
import { listBrochurePdfs, uploadBrochurePdf, removeBrochurePdf, fetchBrochurePdf } from './settingsApi.js';

const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

/**
 * Brochure PDFs, one per state.
 *
 * Different cremation partners operate in different states, so the
 * brochure a family receives has to match whoever is actually handling
 * their pet. The backend supported this from the start; the upload form
 * simply never sent a state, so every file saved as the nationwide
 * 'ALL' copy and overwrote the previous one.
 *
 * A job uses its own state's brochure, falling back to 'ALL'.
 */
export default function BrochureManager({ kind, label }) {
  const [docs, setDocs] = useState(null);
  const [state, setState] = useState('ALL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    listBrochurePdfs(kind).then(setDocs).catch((e) => { setError(e.message); setDocs([]); });
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await uploadBrochurePdf(kind, file, state);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (docState) => {
    if (!window.confirm(
      docState === 'ALL'
        ? 'Remove the nationwide brochure? States without their own brochure will have none.'
        : `Remove the ${docState} brochure? Those clients will get the nationwide one instead.`
    )) return;
    try {
      await removeBrochurePdf(kind, docState);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const hasAll = (docs || []).some((d) => d.state === 'ALL');
  const covered = new Set((docs || []).map((d) => d.state));
  const uncovered = STATES.filter((s) => !covered.has(s));

  return (
    <>
      <p style={styles.hint}>
        {label}. A booking uses its own state&apos;s brochure; anything without one falls back
        to the nationwide copy.
      </p>

      {error && <p style={styles.error}>{error}</p>}

      {docs === null ? (
        <p style={styles.hint}>Loading…</p>
      ) : docs.length === 0 ? (
        <p style={styles.hint}>No brochures uploaded yet.</p>
      ) : (
        docs.map((d) => (
          <div key={d.state} style={styles.row}>
            <span style={styles.stateTag}>{d.state === 'ALL' ? 'Nationwide' : d.state}</span>
            <span style={styles.filename}>{d.filename}</span>
            <button
              onClick={() => fetchBrochurePdf(kind, d.state).catch((e) => setError(e.message))}
              style={styles.linkBtn}
            >
              View
            </button>
            <button onClick={() => remove(d.state)} style={styles.removeBtn}>Remove</button>
          </div>
        ))
      )}

      {/* Named explicitly rather than left implicit: a state with no
          brochure silently receives the nationwide one, which may
          describe a partner who doesn't operate there. */}
      {docs && !hasAll && uncovered.length > 0 && (
        <p style={styles.warn}>
          No nationwide fallback, and no brochure for {uncovered.join(', ')} — clients in those
          states will get nothing.
        </p>
      )}
      {docs && hasAll && uncovered.length > 0 && (
        <p style={styles.hint}>
          {uncovered.join(', ')} will receive the nationwide brochure.
        </p>
      )}

      <div style={styles.uploadRow}>
        <select value={state} onChange={(e) => setState(e.target.value)} style={styles.select}>
          <option value="ALL">Nationwide (fallback)</option>
          {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={styles.uploadBtn}>
          {busy ? 'Uploading…' : `Upload for ${state === 'ALL' ? 'all states' : state}`}
          <input
            type="file"
            accept="application/pdf"
            disabled={busy}
            onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }}
            style={{ display: 'none' }}
          />
        </label>
      </div>
      {covered.has(state) && (
        <p style={styles.hint}>
          Uploading will replace the existing {state === 'ALL' ? 'nationwide' : state} brochure.
        </p>
      )}
    </>
  );
}

const styles = {
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 10 },
  warn: { fontSize: 12, color: 'var(--gm-brick)', lineHeight: 1.6, marginBottom: 10 },
  error: { fontSize: 12, color: 'var(--gm-brick)', marginBottom: 10 },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--gm-line-soft)' },
  stateTag: { fontSize: 11, fontWeight: 600, color: 'var(--gm-forest)', background: '#E3E9E1', padding: '3px 9px', borderRadius: 999, minWidth: 74, textAlign: 'center' },
  filename: { flex: 1, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  linkBtn: { background: 'none', border: 'none', color: 'var(--gm-forest)', fontSize: 12, textDecoration: 'underline' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--gm-brick)', fontSize: 12, textDecoration: 'underline' },
  uploadRow: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 },
  select: { padding: '9px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 13, background: '#fff' },
  uploadBtn: { flex: 1, textAlign: 'center', background: '#fff', color: 'var(--gm-forest)', border: '1px solid var(--gm-forest)', borderRadius: 'var(--gm-radius-sm)', padding: '9px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
};
