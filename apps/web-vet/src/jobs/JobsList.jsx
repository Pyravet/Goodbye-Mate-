import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import { fetchMyJobs } from './jobsApi.js';
import { formatTime as formatTime } from '@goodbye-mate/web-shared/src/format.js';


export default function JobsList() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetchMyJobs('board').then(setJobs).catch(() => setJobs([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    // Offers expire on a timer server-side, so poll while this screen is open
    // so a job accepted or reassigned elsewhere doesn't linger here.
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]);

  // Offers live on their own Offers screen — see OffersPage. They are
  // deliberately NOT shown here: the same decision in two places lets
  // one copy go stale after the vet acts on the other.
  // Today, in the vet's own timezone. A job on today's date is still
  // upcoming right up until midnight — using a timestamp would drop the
  // afternoon's work off the list at lunchtime.
  const todayKey = new Date().toLocaleDateString('en-CA');

  const active = jobs.filter(
    (j) => j.assigned_vet_id && j.status !== 'completed' && j.status !== 'cancelled'
  );

  // UPCOMING means today or later. Filtering on status alone left a job
  // from last week sitting under "Upcoming" indefinitely, which is how a
  // vet ends up scrolling past three dead entries to find tomorrow's
  // work — and can't tell what's real.
  const assigned = active.filter((j) => dateKey(j.job_date) >= todayKey).sort(byWhen);

  // Past but never closed off. Surfaced separately rather than hidden:
  // these are jobs that actually happened and were never completed, and
  // the vet is the only person who can say what became of them.
  const overdue = active.filter((j) => dateKey(j.job_date) < todayKey).sort(byWhen);

  const completed = jobs.filter((j) => j.status === 'completed');


  return (
    <AppShell>
      <div style={styles.page}>
        <div style={styles.headerRow}>
          <h1 style={styles.title}>Your jobs</h1>
          <Link to="/calendar" style={styles.pastLink}>Calendar</Link>
          <Link to="/jobs/past" style={styles.pastLink}>Past jobs →</Link>
        </div>

        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : (
          <>
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

/**
 * "Today", "Tomorrow", or "Fri 28 Aug".
 *
 * Relative labels for the next two days because that's how a vet thinks
 * about their week; an explicit date beyond that.
 */
/**
 * A sortable YYYY-MM-DD key.
 *
 * node-postgres returns DATE columns as Date objects, and the old sort
 * did `a.job_date + a.job_time`, which stringifies to "Sat Aug 22 2026
 * ...". That compares WEEKDAY NAMES alphabetically — "Fri Aug 28" sorts
 * before "Sat Aug 22" — so the order was wrong whenever two jobs fell
 * on different weekdays.
 */
function dateKey(value) {
  if (!value) return '';
  return value instanceof Date
    ? value.toLocaleDateString('en-CA')
    : String(value).slice(0, 10);
}

function byWhen(a, b) {
  return (dateKey(a.job_date) + a.job_time).localeCompare(dateKey(b.job_date) + b.job_time);
}

function formatDay(dateStr) {
  if (!dateStr) return '';
  // node-postgres returns DATE columns as Date objects, and
  // String(aDate) gives "Fri Aug 28 2026 ..." — slicing that to 10
  // chars yields "Fri Aug 28", which parses as Invalid Date. Normalise
  // both shapes. This exact trap has bitten twice before.
  const iso = dateStr instanceof Date
    ? dateStr.toISOString().slice(0, 10)
    : String(dateStr).slice(0, 10);
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function JobRow({ job, muted }) {
  return (
    <Link to={`/jobs/${job.id}`} style={styles.link}>
      <div className="gm-card" style={{ ...styles.card, opacity: muted ? 0.6 : 1 }}>
        {/* The DAY as well as the time. Upcoming jobs are sorted by
            date, so an 8pm job on Friday sits above a 4:35pm job on
            Sunday — correct, but it reads as broken sorting when only
            the time is shown. */}
        <div style={styles.timeCol}>
          <div style={styles.dayLabel}>{formatDay(job.job_date)}</div>
          <div>{formatTime(job.job_time)}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={styles.petRow}>
            {/* All pets. A double euthanasia listed as one animal is
                the wrong work at a glance. */}
            <span style={styles.petName}>{job.pet_names || job.pet_name}</span>
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
  dayLabel: { fontSize: 11, color: 'var(--gm-ink-soft)', fontWeight: 400, marginBottom: 2 },
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
