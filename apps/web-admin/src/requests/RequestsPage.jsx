import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import { fetchRequests, updateRequest } from './requestsApi.js';
import ConvertRequestForm from './ConvertRequestForm.jsx';

const FILTERS = [
  { key: '', label: 'Open' },
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'converted', label: 'Booked' },
  { key: 'declined', label: 'Declined' },
  { key: 'spam', label: 'Spam' },
];

export default function RequestsPage() {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [convertingId, setConvertingId] = useState(null);
  const [loggingId, setLoggingId] = useState(null);

  const load = useCallback(() => {
    fetchRequests(filter).then(setItems).catch((e) => { setError(e.message); setItems([]); });
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id, status) => {
    setError('');
    try {
      await updateRequest(id, { status });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Booking requests</h1>
        <p style={styles.intro}>
          Enquiries from the public form. Call the client, then create the booking through
          <strong> New booking</strong> and mark the request as booked.
        </p>

        <div style={styles.filters}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{ ...styles.filterBtn, ...(filter === f.key ? styles.filterOn : {}) }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && <p style={styles.error}>{error}</p>}

        {items === null ? (
          <p style={styles.empty}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={styles.empty}>Nothing here.</p>
        ) : (
          items.map((r) => (
            <div key={r.id} className="gm-card" style={styles.card}>
              <div style={styles.cardTop}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.name}>
                    {r.client_name}
                    {r.status === 'new' && <span style={styles.newDot} />}
                  </div>
                  <div style={styles.meta}>
                    <a href={`tel:${r.client_phone}`} style={styles.phone}>{r.client_phone}</a>
                    {r.client_email ? ` · ${r.client_email}` : ''}
                  </div>
                </div>
                <span style={styles.time}>
                  {new Date(r.created_at).toLocaleString('en-AU', {
                    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                  })}
                </span>
              </div>

              <div style={styles.detail}>
                {r.pet_name && <Row label="Pet" value={[r.pet_name, r.pet_type, r.pet_breed, r.pet_age].filter(Boolean).join(' · ')} />}
                {(r.address || r.suburb) && <Row label="Where" value={[r.address, r.suburb, r.postcode].filter(Boolean).join(', ')} />}
                {r.service_preference && <Row label="Service" value={r.service_preference} />}
                {r.preferred_timing && <Row label="When" value={r.preferred_timing} />}
                {r.message && <Row label="Notes" value={r.message} />}
              </div>

              {/* The evidence of contact. handled_at was being recorded
                  but never shown, so a card in the Contacted tab looked
                  identical to a new one — you couldn't tell your own
                  follow-up from a colleague's, or whether a call from
                  three days ago had been chased since. */}
              {r.handled_at && r.status !== 'new' && (
                <div style={styles.handled}>
                  {r.status === 'contacted' ? 'Contacted' : r.status === 'declined' ? 'Declined' : 'Handled'}
                  {r.handled_by_name ? ` by ${r.handled_by_name}` : ''}
                  {' · '}
                  {new Date(r.handled_at).toLocaleString('en-AU', {
                    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                  })}
                  {r.admin_notes && <div style={styles.handledNote}>“{r.admin_notes}”</div>}
                </div>
              )}

              {r.converted_job_id ? (
                <Link to={`/jobs/${r.converted_job_id}`} style={styles.linkedJob}>
                  View the booking created from this →
                </Link>
              ) : (
                <div style={styles.actions}>
                  <button onClick={() => setLoggingId(loggingId === r.id ? null : r.id)} style={styles.btn}>
                    {r.status === 'contacted' ? 'Add a note' : 'Log contact'}
                  </button>
                  <button onClick={() => setConvertingId(r.id)} style={styles.btnPrimary}>
                    Create booking
                  </button>
                  {r.status !== 'declined' && (
                    <button onClick={() => setStatus(r.id, 'declined')} style={styles.btnQuiet}>Decline</button>
                  )}
                  {r.status !== 'spam' && (
                    <button onClick={() => setStatus(r.id, 'spam')} style={styles.btnQuiet}>Spam</button>
                  )}
                </div>
              )}

              {loggingId === r.id && (
                <LogContactForm
                  request={r}
                  onCancel={() => setLoggingId(null)}
                  onDone={() => { setLoggingId(null); load(); }}
                  onError={setError}
                />
              )}

              {convertingId === r.id && (
                <ConvertRequestForm
                  request={r}
                  onCancel={() => setConvertingId(null)}
                  onDone={() => { setConvertingId(null); load(); }}
                />
              )}
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}

/**
 * Record that the client was contacted, and what was said.
 *
 * "Mark contacted" alone set a status and nothing else — no time, no
 * person, no substance. With several people handling requests, the
 * useful record is what was actually agreed on the call, since that's
 * what the next person needs before ringing them again.
 */
function LogContactForm({ request, onCancel, onDone, onError }) {
  const [note, setNote] = useState(request.admin_notes || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateRequest(request.id, { status: 'contacted', adminNotes: note.trim() || null });
      onDone();
    } catch (err) {
      onError(err.message);
      setBusy(false);
    }
  };

  return (
    <div style={styles.logBox}>
      <label style={styles.logLabel}>What came out of the call?</label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="e.g. Spoke to Sarah. Wants Thursday afternoon, private cremation. Calling back to confirm the time."
        style={styles.logInput}
        autoFocus
      />
      <p style={styles.logHint}>
        Saved against this request with your name and the time, so whoever picks it up next can see
        what was agreed.
      </p>
      <div style={styles.actions}>
        <button onClick={onCancel} style={styles.btnQuiet}>Cancel</button>
        <button onClick={save} disabled={busy} style={styles.btnPrimary}>
          {busy ? 'Saving…' : 'Save & mark contacted'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={styles.rowValue}>{value}</span>
    </div>
  );
}

const styles = {
  page: { padding: '24px 28px', maxWidth: 760 },
  title: { fontSize: 24, marginBottom: 6 },
  intro: { fontSize: 13, color: 'var(--gm-ink-soft)', marginBottom: 16, lineHeight: 1.5 },
  filters: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  filterBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 999, padding: '6px 14px', fontSize: 12 },
  filterOn: { background: 'var(--gm-forest)', color: '#fff', borderColor: 'var(--gm-forest)' },
  empty: { color: 'var(--gm-ink-soft)', fontSize: 13 },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 10 },
  card: { padding: 16, marginBottom: 12 },
  cardTop: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 },
  name: { fontFamily: 'var(--gm-font-display)', fontSize: 17, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 },
  newDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--gm-brick)' },
  meta: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  phone: { color: 'var(--gm-forest)', fontWeight: 500, textDecoration: 'none' },
  time: { fontSize: 11, color: 'var(--gm-ink-soft)', flexShrink: 0 },
  detail: { borderTop: '1px solid var(--gm-line-soft)', paddingTop: 10, marginBottom: 12 },
  row: { display: 'flex', gap: 10, fontSize: 13, padding: '3px 0' },
  rowLabel: { width: 60, color: 'var(--gm-ink-soft)', flexShrink: 0 },
  rowValue: { flex: 1, minWidth: 0 },
  handled: { fontSize: 12, color: 'var(--gm-forest)', background: '#E3E9E1', padding: '7px 10px', borderRadius: 'var(--gm-radius-sm)', marginBottom: 10, lineHeight: 1.5 },
  handledNote: { color: 'var(--gm-ink)', marginTop: 4, fontStyle: 'italic' },
  logBox: { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--gm-line)' },
  logLabel: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 5 },
  logInput: { width: '100%', padding: '10px 12px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', background: '#fff' },
  logHint: { fontSize: 11, color: 'var(--gm-ink-soft)', fontStyle: 'italic', margin: '6px 0 10px', lineHeight: 1.4 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  btn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '8px 14px', fontSize: 12, fontWeight: 500 },
  btnPrimary: { background: 'var(--gm-forest)', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: 'var(--gm-radius-sm)', padding: '8px 14px', fontSize: 12, fontWeight: 500, textDecoration: 'none' },
  btnQuiet: { background: 'none', border: 'none', color: 'var(--gm-ink-soft)', fontSize: 12, textDecoration: 'underline' },
  linkedJob: { fontSize: 13, color: 'var(--gm-forest)', fontWeight: 500, textDecoration: 'none' },
};
