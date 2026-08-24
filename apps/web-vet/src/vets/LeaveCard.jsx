import { useState, useEffect } from 'react';
import { fetchLeave, addLeave, removeLeave } from './vetsApi.js';

function fmt(d) {
  return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/**
 * Time away.
 *
 * Availability already existed as weekly hours plus per-DAY overrides,
 * so booking a fortnight off meant ticking fourteen individual days —
 * which nobody does. Dispatch therefore kept offering jobs the vet
 * couldn't take, and every offer they let lapse counted against their
 * reliability stats. They were being penalised for the system not
 * knowing they were away.
 */
export default function LeaveCard({ vetId }) {
  const [leave, setLeave] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ startsOn: '', endsOn: '', reason: '' });
  const [clashes, setClashes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => fetchLeave(vetId).then(setLeave).catch(() => setLeave([]));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [vetId]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await addLeave(vetId, form);
      // Jobs already accepted inside the period are surfaced rather than
      // cancelled: someone has to decide what happens to each, and
      // silently dropping a commitment a client is expecting would be
      // far worse than being told about it.
      setClashes(result.clashingJobs?.length ? result.clashingJobs : null);
      setForm({ startsOn: '', endsOn: '', reason: '' });
      setAdding(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Remove this leave? You may start receiving job offers for those dates again.')) return;
    try {
      await removeLeave(vetId, id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Time off</h3>
      <p style={styles.hint}>
        Dates you&apos;re away. You won&apos;t be offered jobs on these days, and they won&apos;t
        count against your response record.
      </p>

      {error && <p style={styles.error}>{error}</p>}

      {clashes && (
        <div style={styles.clashBox}>
          <strong>You already have {clashes.length} job{clashes.length === 1 ? '' : 's'} booked in that period.</strong>
          <div style={styles.clashHint}>
            These haven&apos;t been cancelled. Please let the office know so they can be reassigned.
          </div>
          {clashes.map((c) => (
            <div key={c.id} style={styles.clashJob}>
              {c.pet_name} — {fmt(c.job_date)} at {String(c.job_time).slice(0, 5)}
            </div>
          ))}
        </div>
      )}

      {leave === null ? (
        <p style={styles.hint}>Loading…</p>
      ) : leave.length === 0 ? (
        <p style={styles.hint}>No leave booked.</p>
      ) : (
        leave.map((l) => (
          <div key={l.id} style={styles.row}>
            <div>
              <div style={styles.dates}>
                {fmt(l.starts_on)} – {fmt(l.ends_on)}
              </div>
              {l.reason && <div style={styles.reason}>{l.reason}</div>}
            </div>
            <button onClick={() => remove(l.id)} style={styles.remove}>Remove</button>
          </div>
        ))
      )}

      {!adding ? (
        <button onClick={() => setAdding(true)} style={styles.addBtn}>+ Book time off</button>
      ) : (
        <div style={styles.form}>
          <label style={styles.label}>
            From
            <input type="date" value={form.startsOn} onChange={set('startsOn')} style={styles.input} />
          </label>
          <label style={styles.label}>
            To (inclusive)
            <input type="date" value={form.endsOn} onChange={set('endsOn')} style={styles.input} />
          </label>
          <label style={styles.label}>
            Reason (optional)
            <input value={form.reason} onChange={set('reason')} placeholder="e.g. Annual leave" style={styles.input} />
          </label>
          <div style={styles.actions}>
            <button onClick={() => { setAdding(false); setError(''); }} style={styles.cancelBtn}>Cancel</button>
            <button onClick={save} disabled={busy || !form.startsOn || !form.endsOn} style={styles.saveBtn}>
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
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--gm-line-soft)' },
  dates: { fontSize: 14, fontWeight: 500 },
  reason: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  remove: { background: 'none', border: 'none', color: 'var(--gm-brick)', fontSize: 12, textDecoration: 'underline', minHeight: 44 },
  addBtn: { width: '100%', background: '#fff', color: 'var(--gm-forest)', border: '1px solid var(--gm-forest)', borderRadius: 'var(--gm-radius-sm)', padding: '11px 0', fontSize: 14, fontWeight: 500, marginTop: 12, minHeight: 44 },
  form: { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--gm-line)' },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 10 },
  input: { width: '100%', padding: '11px 12px', marginTop: 4, borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 15, fontFamily: 'inherit', background: '#fff' },
  actions: { display: 'flex', gap: 8 },
  cancelBtn: { flex: 1, background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '11px 0', fontSize: 14, minHeight: 44 },
  saveBtn: { flex: 1, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '11px 0', fontSize: 14, fontWeight: 500, minHeight: 44 },
  clashBox: { background: 'var(--gm-honey-soft)', color: '#7A5A22', padding: '11px 13px', borderRadius: 'var(--gm-radius-sm)', marginBottom: 12, fontSize: 13, lineHeight: 1.5 },
  clashHint: { fontSize: 12, marginTop: 4 },
  clashJob: { fontSize: 12, marginTop: 4 },
};
