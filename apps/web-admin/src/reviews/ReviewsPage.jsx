import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import { fetchAllReviews } from '../jobs/jobsApi.js';

/**
 * Client feedback.
 *
 * Reviews were being written into the database and read by nobody —
 * there was no admin route or screen for them anywhere. That mattered
 * most for the low ratings, where the client was specifically asked
 * "what could we have done better" and took the trouble to answer.
 */
export default function ReviewsPage() {
  const [data, setData] = useState(null);
  const [lowOnly, setLowOnly] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchAllReviews(lowOnly)
      .then(setData)
      .catch((err) => { setError(err.message); setData({ reviews: [], stats: {} }); });
  }, [lowOnly]);

  useEffect(() => { load(); }, [load]);

  const stats = data?.stats || {};

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Client feedback</h1>

        {error && <p style={styles.error}>{error}</p>}

        {data && (
          <div style={styles.statRow}>
            <Stat label="Reviews" value={stats.total ?? 0} />
            <Stat label="Average" value={stats.average ? `${stats.average}★` : '—'} />
            <Stat label="3★ or below" value={stats.low ?? 0} warn={(stats.low ?? 0) > 0} />
            <Stat label="With comments" value={stats.with_comment ?? 0} />
          </div>
        )}

        <div style={styles.filters}>
          <button
            onClick={() => setLowOnly(false)}
            style={{ ...styles.filterBtn, ...(!lowOnly ? styles.filterOn : {}) }}
          >
            All
          </button>
          <button
            onClick={() => setLowOnly(true)}
            style={{ ...styles.filterBtn, ...(lowOnly ? styles.filterOn : {}) }}
          >
            Needs attention (3★ or below)
          </button>
        </div>

        {!data ? (
          <p style={styles.empty}>Loading…</p>
        ) : data.reviews.length === 0 ? (
          <p style={styles.empty}>
            {lowOnly ? 'No low ratings — good.' : 'No reviews yet.'}
          </p>
        ) : (
          data.reviews.map((r) => (
            <div key={r.job_id} className="gm-card" style={styles.card}>
              <div style={styles.cardHead}>
                <div style={styles.stars}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} style={styles.star}>{n <= r.rating ? '★' : '☆'}</span>
                  ))}
                </div>
                <span style={styles.date}>
                  {new Date(r.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>

              {r.comment ? (
                <p style={styles.comment}>&ldquo;{r.comment}&rdquo;</p>
              ) : (
                <p style={styles.noComment}>No written comment.</p>
              )}

              <div style={styles.meta}>
                <Link to={`/jobs/${r.job_id}`} style={styles.link}>
                  {r.job_number} · {r.pet_name}
                </Link>
                {' · '}{r.client_name}
                {r.vet_name && ` · vet: ${r.vet_name}`}
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}

function Stat({ label, value, warn }) {
  return (
    <div style={styles.stat}>
      <div style={{ ...styles.statValue, ...(warn ? styles.statWarn : {}) }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

const styles = {
  page: { padding: '24px 28px', maxWidth: 760 },
  title: { fontSize: 24, marginBottom: 16 },
  error: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 12 },
  statRow: { display: 'flex', gap: 8, marginBottom: 18 },
  stat: { flex: 1, background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '12px 8px', textAlign: 'center', minWidth: 0 },
  statValue: { fontFamily: 'var(--gm-font-display)', fontSize: 20, fontWeight: 600, color: 'var(--gm-forest-dark)' },
  statWarn: { color: 'var(--gm-brick)' },
  statLabel: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 2 },
  filters: { display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' },
  filterBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 999, padding: '7px 14px', fontSize: 12 },
  filterOn: { background: 'var(--gm-forest)', color: '#fff', borderColor: 'var(--gm-forest)' },
  empty: { fontSize: 13, color: 'var(--gm-ink-soft)' },
  card: { padding: 16, marginBottom: 10 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  stars: { display: 'flex', gap: 2 },
  star: { fontSize: 18, color: 'var(--gm-honey)' },
  date: { fontSize: 11, color: 'var(--gm-ink-soft)' },
  comment: { fontSize: 14, lineHeight: 1.6, fontStyle: 'italic', marginBottom: 10 },
  noComment: { fontSize: 12, color: 'var(--gm-ink-soft)', fontStyle: 'italic', marginBottom: 10 },
  meta: { fontSize: 12, color: 'var(--gm-ink-soft)' },
  link: { color: 'var(--gm-forest)', fontWeight: 500, textDecoration: 'none' },
};
