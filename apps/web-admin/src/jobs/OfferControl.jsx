import { useEffect, useState, useCallback } from 'react';
import { fetchVets } from '../vets/vetsApi.js';
import { offerToVets, fetchOfferStatus } from './jobsApi.js';

function timeLeft(expiresAt) {
  if (!expiresAt) return null;
  const mins = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000);
  if (mins <= 0) return 'expired';
  if (mins < 60) return `${mins}m left`;
  return `${Math.round(mins / 60)}h left`;
}

/**
 * Offer a job to one or several vets, and track what each said.
 *
 * Offering to several at once is the point: the first to accept takes
 * it. Vets who were offered it and didn't respond are as important to
 * see as those who declined, which is why every outcome is listed rather
 * than just the accepted one.
 */
export default function OfferControl({ job, onChanged }) {
  const [open, setOpen] = useState(false);
  const [vets, setVets] = useState(null);
  const [selected, setSelected] = useState([]);
  const [expiryMinutes, setExpiryMinutes] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);

  const loadStatus = useCallback(() => {
    fetchOfferStatus(job.id).then(setStatus).catch(() => setStatus([]));
  }, [job.id]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const openPicker = async () => {
    setOpen(true);
    setError('');
    if (vets) return;
    try {
      const list = await fetchVets();
      setVets(list.filter((v) => v.is_active));
    } catch {
      setError('Could not load the vet list.');
    }
  };

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const send = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    setError('');
    try {
      await offerToVets(job.id, selected, Number(expiryMinutes));
      setOpen(false);
      setSelected([]);
      loadStatus();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const live = (status || []).filter((o) => o.outcome === 'offered');
  const proposals = (status || []).filter((o) => o.outcome === 'proposed');
  const responded = (status || []).filter((o) => ['declined', 'accepted'].includes(o.outcome));

  return (
    <div style={styles.wrap}>
      {/* Proposed times first — they need a decision, and a vet waiting
          on an answer is more urgent than a list of declines. */}
      {proposals.length > 0 && (
        <div style={styles.proposalBox}>
          <div style={styles.proposalTitle}>Alternative times suggested</div>
          {proposals.map((p, i) => (
            <div key={i} style={styles.proposalRow}>
              <strong>{p.vet_name}</strong> can do{' '}
              {new Date(`${String(p.proposed_date).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-AU', {
                weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
              })}{' '}
              at {String(p.proposed_time).slice(0, 5)}
              {p.proposal_note && <div style={styles.proposalNote}>“{p.proposal_note}”</div>}
              <div style={styles.proposalHint}>
                Confirm with the client first, then change the job time and offer it to them.
              </div>
            </div>
          ))}
        </div>
      )}

      {live.length > 0 && (
        <div style={styles.statusBlock}>
          <div style={styles.statusLabel}>Waiting on</div>
          {live.map((o, i) => (
            <div key={i} style={styles.statusRow}>
              <span>{o.vet_name}</span>
              <span style={styles.statusMeta}>{timeLeft(o.expires_at)}</span>
            </div>
          ))}
        </div>
      )}

      {responded.length > 0 && (
        <div style={styles.statusBlock}>
          <div style={styles.statusLabel}>Responses</div>
          {responded.map((o, i) => (
            <div key={i} style={styles.statusRow}>
              <span>{o.vet_name}</span>
              <span style={{
                ...styles.statusMeta,
                color: o.outcome === 'accepted' ? 'var(--gm-forest)' : 'var(--gm-brick)',
              }}>
                {o.outcome}
              </span>
            </div>
          ))}
        </div>
      )}

      {!open ? (
        <button onClick={openPicker} style={styles.primaryBtn}>
          {live.length > 0 ? 'Offer to more vets' : 'Offer to vets'}
        </button>
      ) : (
        <div style={styles.picker}>
          {error && <p style={styles.error}>{error}</p>}
          <div style={styles.pickerLabel}>
            Choose who to offer this to — the first to accept takes the job.
          </div>

          {vets === null ? (
            <p style={styles.hint}>Loading vets…</p>
          ) : vets.length === 0 ? (
            <p style={styles.hint}>No active vets.</p>
          ) : (
            <div style={styles.chipRow}>
              {vets.map((v) => {
                const alreadyLive = live.some((o) => o.vet_id === v.id);
                return (
                  <button
                    key={v.id}
                    onClick={() => toggle(v.id)}
                    style={{
                      ...styles.chip,
                      ...(selected.includes(v.id) ? styles.chipOn : {}),
                    }}
                    title={alreadyLive ? 'Already has a live offer — re-offering resets their timer' : undefined}
                  >
                    {v.full_name}{alreadyLive ? ' ·' : ''}
                  </button>
                );
              })}
            </div>
          )}

          <label style={styles.expiryRow}>
            Expires after
            <select value={expiryMinutes} onChange={(e) => setExpiryMinutes(e.target.value)} style={styles.select}>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={180}>3 hours</option>
              <option value={720}>12 hours</option>
            </select>
          </label>

          <div style={styles.actions}>
            <button onClick={() => setOpen(false)} style={styles.cancelBtn}>Cancel</button>
            <button onClick={send} disabled={busy || selected.length === 0} style={styles.primaryBtn}>
              {busy
                ? 'Sending…'
                : selected.length > 1 ? `Offer to ${selected.length} vets` : 'Send offer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--gm-line-soft)' },
  primaryBtn: { flex: 1, width: '100%', background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '9px', fontSize: 13, fontWeight: 500 },
  cancelBtn: { flex: 1, background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '9px', fontSize: 13, fontWeight: 500 },
  picker: { marginTop: 4 },
  pickerLabel: { fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 8, lineHeight: 1.4 },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', fontStyle: 'italic' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 999, padding: '6px 12px', fontSize: 12 },
  chipOn: { background: 'var(--gm-forest)', color: '#fff', borderColor: 'var(--gm-forest)' },
  expiryRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 10 },
  select: { padding: '6px 8px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 12, background: '#fff' },
  actions: { display: 'flex', gap: 8 },
  error: { fontSize: 12, color: 'var(--gm-brick)', marginBottom: 8 },
  statusBlock: { marginBottom: 10 },
  statusLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginBottom: 4 },
  statusRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' },
  statusMeta: { fontSize: 11, color: 'var(--gm-ink-soft)' },
  proposalBox: { background: 'var(--gm-honey-soft)', borderRadius: 'var(--gm-radius-sm)', padding: '10px 12px', marginBottom: 12 },
  proposalTitle: { fontSize: 12, fontWeight: 600, color: '#7A5A22', marginBottom: 6 },
  proposalRow: { fontSize: 13, marginBottom: 8, lineHeight: 1.5 },
  proposalNote: { fontStyle: 'italic', color: 'var(--gm-ink-soft)', marginTop: 2 },
  proposalHint: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 3 },
};
