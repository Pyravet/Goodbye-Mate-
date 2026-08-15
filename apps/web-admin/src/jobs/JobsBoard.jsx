import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import JobCard from './JobCard.jsx';
import AlertsStrip from './AlertsStrip.jsx';
import { fetchJobs } from './jobsApi.js';

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'board', label: 'All jobs' },
];

export default function JobsBoard() {
  const [tab, setTab] = useState('today');
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchJobs(tab).then(setJobs).catch(() => setJobs([])).finally(() => setLoading(false));
  }, [tab]);

  const filtered = search
    ? jobs.filter((j) =>
        [j.pet_name, j.client_name, j.suburb, j.job_number].some((f) => f?.toLowerCase().includes(search.toLowerCase()))
      )
    : jobs;

  return (
    <AppShell>
      <div style={styles.page}>
        <div style={styles.headerRow}>
          <h1 style={styles.title}>Jobs</h1>
          <Link to="/jobs/new" style={styles.newBtn}>+ New booking</Link>
        </div>

        <AlertsStrip />

        <div style={styles.controlsRow}>
          <div style={styles.tabs}>
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{ ...styles.tab, ...(tab === t.key ? styles.tabActive : {}) }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search pet, client, suburb…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.search}
          />
        </div>

        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : filtered.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>
              {tab === 'today' ? 'Nothing on the books for today.' : 'No jobs here yet.'}
            </p>
            <p style={styles.emptyBody}>New bookings will appear as they come in.</p>
          </div>
        ) : (
          <div>
            {filtered.map((job) => (
              <JobCard key={job.id} job={job} showDate={tab !== 'today'} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

const styles = {
  page: { padding: '32px 40px', maxWidth: 840 },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 26 },
  newBtn: {
    background: 'var(--gm-forest)',
    color: '#fff',
    padding: '9px 16px',
    borderRadius: 'var(--gm-radius-sm)',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 500,
  },
  controlsRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 16 },
  tabs: { display: 'flex', gap: 4, background: 'var(--gm-line-soft)', padding: 3, borderRadius: 'var(--gm-radius-sm)' },
  tab: {
    background: 'none',
    border: 'none',
    padding: '6px 14px',
    borderRadius: 5,
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--gm-ink-soft)',
  },
  tabActive: { background: '#fff', color: 'var(--gm-forest-dark)', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' },
  search: {
    padding: '7px 12px',
    borderRadius: 'var(--gm-radius-sm)',
    border: '1px solid var(--gm-line)',
    fontSize: 13,
    width: 220,
    background: '#fff',
  },
  empty: { color: 'var(--gm-ink-soft)', fontSize: 13 },
  emptyState: { padding: '48px 0', textAlign: 'center' },
  emptyTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 17, marginBottom: 4 },
  emptyBody: { color: 'var(--gm-ink-soft)', fontSize: 13 },
};
