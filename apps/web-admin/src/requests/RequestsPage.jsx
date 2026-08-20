import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import { fetchRequests, updateRequest } from './requestsApi.js';

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

              {r.converted_job_id ? (
                <Link to={`/jobs/${r.converted_job_id}`} style={styles.linkedJob}>
                  View the booking created from this →
                </Link>
              ) : (
                <div style={styles.actions}>
                  {r.status !== 'contacted' && (
                    <button onClick={() => setStatus(r.id, 'contacted')} style={styles.btn}>Mark contacted</button>
                  )}
                  <Link to="/jobs/new" style={styles.btnPrimary}>Create booking</Link>
                  {r.status !== 'declined' && (
                    <button onClick={() => setStatus(r.id, 'declined')} style={styles.btnQuiet}>Decline</button>
                  )}
                  {r.status !== 'spam' && (
                    <button onClick={() => setStatus(r.id, 'spam')} style={styles.btnQuiet}>Spam</button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </AppShell>
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
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  btn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '8px 14px', fontSize: 12, fontWeight: 500 },
  btnPrimary: { background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '8px 14px', fontSize: 12, fontWeight: 500, textDecoration: 'none' },
  btnQuiet: { background: 'none', border: 'none', color: 'var(--gm-ink-soft)', fontSize: 12, textDecoration: 'underline' },
  linkedJob: { fontSize: 13, color: 'var(--gm-forest)', fontWeight: 500, textDecoration: 'none' },
};
