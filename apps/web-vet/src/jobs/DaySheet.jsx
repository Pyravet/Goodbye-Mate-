import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import { fetchMyJobs } from './jobsApi.js';
import { formatTime } from '@goodbye-mate/web-shared/src/format.js';

const SERVICE_LABELS = {
  euthanasia_only: 'Euthanasia',
  private_cremation: 'Euthanasia + private cremation',
  communal_cremation: 'Euthanasia + communal cremation',
};

/**
 * Today, in order.
 *
 * The jobs list answers "what do I have on"; this answers "what am I
 * doing next". A vet standing at their car at 8am needs the address,
 * the client's number, and anything unusual about the visit — not a
 * list they have to tap into four times.
 *
 * Everything actionable is one tap: address opens maps, phone dials.
 */
export default function DaySheet() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchMyJobs('today')
      .then((all) => {
        // Offers aren't work they hold yet — those live on the Offers
        // screen. Cancelled jobs would only add noise to a run sheet.
        const mine = all.filter((j) => !j.isOffer && j.status !== 'cancelled');
        mine.sort((a, b) => String(a.job_time).localeCompare(String(b.job_time)));
        setJobs(mine);
      })
      .catch((err) => { setError(err.message); setJobs([]); });
  }, []);

  useEffect(() => {
    load();
    // A job can be reassigned or cancelled while the vet is out, and a
    // stale run sheet sends someone to the wrong door.
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const remaining = (jobs || []).filter((j) => j.status !== 'completed').length;

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Today</h1>
        <p style={styles.date}>
          {today}
          {jobs && jobs.length > 0 && ` · ${remaining} to go`}
        </p>

        {error && <p style={styles.error}>{error}</p>}

        {jobs === null ? (
          <p style={styles.empty}>Loading…</p>
        ) : jobs.length === 0 ? (
          <p style={styles.empty}>Nothing booked today.</p>
        ) : (
          jobs.map((job, i) => <DayRow key={job.id} job={job} index={i + 1} />)
        )}
      </div>
    </AppShell>
  );
}

function DayRow({ job, index }) {
  const done = job.status === 'completed';
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(job.address || '')}`;

  return (
    <div className="gm-card" style={{ ...styles.card, ...(done ? styles.cardDone : {}) }}>
      <div style={styles.head}>
        <div style={styles.timeBlock}>
          <div style={styles.time}>{formatTime(job.job_time)}</div>
          {job.job_time_end && (
            <div style={styles.timeEnd}>to {formatTime(job.job_time_end)}</div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.pet}>
            <span style={styles.index}>{index}.</span> {job.pet_name}
          </div>
          <div style={styles.meta}>
            {[job.pet_type, job.pet_breed, job.pet_weight].filter(Boolean).join(' · ')}
          </div>
        </div>
        {done && <span className="gm-badge gm-badge--forest">Done</span>}
      </div>

      {/* Admin notes first and prominent: they're operational
          instructions the vet needs BEFORE arriving — parking, who'll be
          present, an aggressive dog — and burying them below the fold is
          how they get missed. */}
      {job.admin_notes && (
        <div style={styles.adminNote}>
          <strong>Note:</strong> {job.admin_notes}
        </div>
      )}

      <div style={styles.detail}>{SERVICE_LABELS[job.service_type] || job.service_type}</div>

      {/* Readiness at a glance. A vet arriving to find consent unsigned
          or payment outstanding has to handle it at the door, in front
          of a grieving family — far better to know in the car. */}
      <div style={styles.flags}>
        <Flag ok={job.consent_signed} label="Consent" />
        <Flag ok={job.payment_status === 'paid'} label="Paid" />
      </div>

      <div style={styles.actions}>
        <a href={mapsUrl} target="_blank" rel="noreferrer" style={styles.actionBtn}>
          📍 {job.suburb || 'Directions'}
        </a>
        {job.client_phone && (
          <a href={`tel:${job.client_phone}`} style={styles.actionBtn}>
            📞 {job.client_name?.split(' ')[0] || 'Call'}
          </a>
        )}
        <Link to={`/jobs/${job.id}`} style={styles.actionBtnPrimary}>Open</Link>
      </div>
    </div>
  );
}

function Flag({ ok, label }) {
  return (
    <span style={{ ...styles.flag, ...(ok ? styles.flagOk : styles.flagPending) }}>
      {ok ? '✓' : '!'} {label}
    </span>
  );
}

const styles = {
  page: { padding: '20px 16px' },
  title: { fontSize: 24, marginBottom: 2 },
  date: { fontSize: 13, color: 'var(--gm-ink-soft)', marginBottom: 18 },
  empty: { fontSize: 14, color: 'var(--gm-ink-soft)' },
  error: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 12 },
  card: { padding: 16, marginBottom: 12 },
  cardDone: { opacity: 0.6 },
  head: { display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 10 },
  timeBlock: { minWidth: 74, flexShrink: 0 },
  time: { fontFamily: 'var(--gm-font-display)', fontSize: 19, fontWeight: 600 },
  timeEnd: { fontSize: 11, color: 'var(--gm-ink-soft)' },
  index: { color: 'var(--gm-ink-soft)', fontWeight: 400 },
  pet: { fontFamily: 'var(--gm-font-display)', fontSize: 18, fontWeight: 600 },
  meta: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  adminNote: { fontSize: 13, lineHeight: 1.5, background: 'var(--gm-honey-soft)', color: '#7A5A22', padding: '9px 11px', borderRadius: 'var(--gm-radius-sm)', marginBottom: 10 },
  detail: { fontSize: 13, color: 'var(--gm-ink-soft)', marginBottom: 8 },
  flags: { display: 'flex', gap: 8, marginBottom: 12 },
  flag: { fontSize: 11, padding: '3px 9px', borderRadius: 999, fontWeight: 500 },
  flagOk: { background: '#E3E9E1', color: 'var(--gm-forest)' },
  // Red, matching the jobs list, past jobs and the admin board.
  // Consent unsigned an hour before a visit is a problem, not a note.
  flagPending: { background: '#F5E3E0', color: 'var(--gm-brick)' },
  actions: { display: 'flex', gap: 8 },
  actionBtn: { flex: 1, textAlign: 'center', background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '11px 6px', fontSize: 13, fontWeight: 500, textDecoration: 'none', color: 'var(--gm-ink)', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap' },
  actionBtnPrimary: { flex: 1, textAlign: 'center', background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '11px 6px', fontSize: 13, fontWeight: 500, textDecoration: 'none', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' },
};
