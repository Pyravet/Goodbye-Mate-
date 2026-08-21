import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import { fetchMyJobs, acceptOffer, declineOffer } from './jobsApi.js';
import { formatTime as formatTime } from '@goodbye-mate/web-shared/src/format.js';


export default function JobsList() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchMyJobs('board').then(setJobs).catch(() => setJobs([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    // Offers expire on a timer server-side, so poll while this screen is open
    // to keep pending offers accurate without the vet needing to pull-to-refresh.
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]);

  // Offers live on their own Offers screen now. Filtering them OUT here
  // avoids showing the same decision in two places, where one copy can
  // go stale after the vet acts on the other.
  const offers = [];
  const assigned = jobs
    .filter((j) => j.assigned_vet_id && j.status !== 'completed' && j.status !== 'cancelled')
    .sort((a, b) => (a.job_date + a.job_time).localeCompare(b.job_date + b.job_time));
  const completed = jobs.filter((j) => j.status === 'completed');

  const onAccept = async (id) => {
    setBusyId(id);
    try { await acceptOffer(id); load(); } finally { setBusyId(null); }
  };
  const onDecline = async (id) => {
    setBusyId(id);
    try { await declineOffer(id); load(); } finally { setBusyId(null); }
  };

  return (
    <AppShell>
      <div style={styles.page}>
        <div style={styles.headerRow}>
          <h1 style={styles.title}>Your jobs</h1>
          <Link to="/jobs/past" style={styles.pastLink}>Past jobs →</Link>
        </div>

        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : (
          <>
            {offers.length > 0 && (
              <Section title="New offers">
                {offers.map((job) => (
                  <div key={job.id} className="gm-card" style={styles.offerCard}>
                    <Link to={`/jobs/${job.id}`} style={styles.offerLink}>
                      <div style={styles.petName}>{job.pet_name}</div>
                      <div style={styles.subline}>{job.suburb || job.postcode} · {new Date(job.job_date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} at {formatTime(job.job_time)}</div>
                    </Link>
                    <div style={styles.offerActions}>
                      <button onClick={() => onDecline(job.id)} disabled={busyId === job.id} style={styles.declineBtn}>Decline</button>
                      <button onClick={() => onAccept(job.id)} disabled={busyId === job.id} style={styles.acceptBtn}>Accept</button>
                    </div>
                  </div>
                ))}
              </Section>
            )}

            <Section title="Upcoming">
              {assigned.length === 0 ? (
                <p style={styles.empty}>Nothing assigned right now.</p>
              ) : (
                assigned.map((job) => <JobRow key={job.id} job={job} />)
              )}
            </Section>

            {completed.length > 0 && (
              <Section title="Recently completed">
                {completed.slice(0, 10).map((job) => <JobRow key={job.id} job={job} muted />)}
              </Section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function Section({ title, children, action }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={styles.sectionHeader}>
        <h3 style={styles.sectionTitle}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function JobRow({ job, muted }) {
  return (
    <Link to={`/jobs/${job.id}`} style={styles.link}>
      <div className="gm-card" style={{ ...styles.card, opacity: muted ? 0.6 : 1 }}>
        <div style={styles.timeCol}>{formatTime(job.job_time)}</div>
        <div style={{ flex: 1 }}>
          <div style={styles.petRow}>
            <span style={styles.petName}>{job.pet_name}</span>
            {job.vet_unread_messages && <span style={styles.unreadDot} title="New message" />}
            {job.admin_notes && <span style={styles.noteFlag} title="Note from admin">📌</span>}
            {job.status === 'in_route' && <span className="gm-badge gm-badge--forest">On the way</span>}
            {job.status === 'started' && <span className="gm-badge gm-badge--honey">In progress</span>}
          </div>
          <div style={styles.subline}>{job.client_name} · {job.suburb || job.postcode}</div>
        </div>
      </div>
    </Link>
  );
}

const styles = {
  page: { padding: '20px 16px' },
  title: { fontSize: 22 },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  pastLink: { fontSize: 13, fontWeight: 500, color: 'var(--gm-forest)', textDecoration: 'none' },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', fontFamily: 'var(--gm-font-body)', fontWeight: 600, marginBottom: 0 },
  empty: { color: 'var(--gm-ink-soft)', fontSize: 13 },
  link: { textDecoration: 'none', color: 'inherit', display: 'block' },
  card: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 8 },
  timeCol: { fontFamily: 'var(--gm-font-display)', fontSize: 15, fontWeight: 600, color: 'var(--gm-forest-dark)', width: 60, flexShrink: 0 },
  petRow: { display: 'flex', alignItems: 'center', gap: 8 },
  noteFlag: { fontSize: 12, flexShrink: 0 },
  unreadDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--gm-brick)', flexShrink: 0 },
  petName: { fontFamily: 'var(--gm-font-display)', fontSize: 16, fontWeight: 600 },
  subline: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 2 },
  offerCard: { padding: '14px 14px 12px', marginBottom: 10, borderColor: 'var(--gm-honey)', borderWidth: 2 },
  offerLink: { textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 10 },
  offerActions: { display: 'flex', gap: 8 },
  declineBtn: { flex: 1, padding: '10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', background: '#fff', fontSize: 14, fontWeight: 500 },
  acceptBtn: { flex: 1, padding: '10px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 14, fontWeight: 500 },
};
