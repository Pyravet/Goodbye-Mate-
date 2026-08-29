import { useEffect, useState, useMemo } from 'react';
import { formatJobDate, jobDateInputValue } from '@goodbye-mate/web-shared';
import { jobStatusBadges, jobStatusTone } from '@goodbye-mate/web-shared';
import { Link } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import { fetchMyJobs } from './jobsApi.js';
import { formatTime as formatTime } from '@goodbye-mate/web-shared/src/format.js';

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

export default function PastJobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    fetchMyJobs('past').then(setJobs).catch(() => setJobs([])).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return jobs
      .filter((j) => {
        const jobDateStr = typeof j.job_date === 'string' ? j.job_date.slice(0, 10) : toDateStr(new Date(j.job_date));
        if (fromDate && jobDateStr < fromDate) return false;
        if (toDate && jobDateStr > toDate) return false;
        if (search) {
          const q = search.toLowerCase();
          const haystack = [j.pet_names || j.pet_name, j.client_name, j.suburb, j.job_number].filter(Boolean).join(' ').toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.job_date + b.job_time).localeCompare(a.job_date + a.job_time));
  }, [jobs, search, fromDate, toDate]);

  const clearFilters = () => { setSearch(''); setFromDate(''); setToDate(''); };
  const hasFilters = search || fromDate || toDate;

  return (
    <AppShell>
      <div style={styles.page}>
        <Link to="/" style={styles.back}>← Jobs</Link>
        <h1 style={styles.title}>Past jobs</h1>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search pet or client…"
          style={styles.search}
        />

        <div style={styles.dateRow}>
          <label style={styles.dateLabel}>
            From
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={styles.dateInput} />
          </label>
          <label style={styles.dateLabel}>
            To
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={styles.dateInput} />
          </label>
        </div>

        {hasFilters && (
          <button onClick={clearFilters} style={styles.clearBtn}>Clear filters</button>
        )}

        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={styles.empty}>{jobs.length === 0 ? 'No past jobs yet.' : 'No jobs match your filters.'}</p>
        ) : (
          <div style={styles.list}>
            {filtered.map((job) => (
              <Link key={job.id} to={`/jobs/${job.id}`} style={styles.link}>
                <div
                  className="gm-card"
                  style={{
                    ...styles.card,
                    borderLeft: `4px solid var(--gm-${jobStatusTone(job)})`,
                  }}
                >
                  <div style={styles.dateCol}>
                    <div style={styles.date}>{formatJobDate(job.job_date)}</div>
                    <div style={styles.time}>{formatTime(job.job_time)}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={styles.petName}>{job.pet_names || job.pet_name}</div>
                    <div style={styles.subline}>{job.client_name} · {job.suburb || job.postcode}</div>
                  </div>
                  {/* Every card, not just cancelled. A blank row could
                      mean completed, unpaid, or never closed off, and
                      the vet had no way to tell them apart. Shared with
                      the jobs list and admin board. */}
                  {jobStatusBadges(job).map((b) => (
                    <span key={b.label} className={`gm-badge gm-badge--${b.tone}`}>{b.label}</span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

const styles = {
  page: { padding: '20px 16px' },
  back: { fontSize: 13, color: 'var(--gm-ink-soft)', textDecoration: 'none' },
  title: { fontSize: 22, margin: '10px 0 16px' },
  search: { width: '100%', padding: '10px 12px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 15, marginBottom: 10, background: '#fff' },
  dateRow: { display: 'flex', gap: 10, marginBottom: 10 },
  dateLabel: { flex: 1, fontSize: 12, color: 'var(--gm-ink-soft)' },
  dateInput: { display: 'block', width: '100%', marginTop: 4, padding: '9px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, background: '#fff' },
  clearBtn: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '8px 14px', fontSize: 12, fontWeight: 500, marginBottom: 16 },
  empty: { color: 'var(--gm-ink-soft)', fontSize: 13, marginTop: 12 },
  list: { marginTop: 6 },
  link: { textDecoration: 'none', color: 'inherit', display: 'block' },
  card: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 8 },
  dateCol: { width: 56, flexShrink: 0 },
  date: { fontSize: 13, fontWeight: 600, color: 'var(--gm-forest-dark)' },
  time: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 1 },
  petName: { fontFamily: 'var(--gm-font-display)', fontSize: 16, fontWeight: 600 },
  subline: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 2 },
};
