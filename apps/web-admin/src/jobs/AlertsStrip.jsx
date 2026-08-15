import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fetchAlerts } from './jobsApi.js';

export default function AlertsStrip() {
  const [alerts, setAlerts] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAlerts().then(setAlerts).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading || alerts.length === 0) return null;

  const highCount = alerts.filter((a) => a.severity === 'high').length;

  return (
    <div style={styles.wrap}>
      <button onClick={() => setExpanded((e) => !e)} style={styles.header}>
        <span style={styles.dot} />
        <span>{alerts.length} job{alerts.length === 1 ? '' : 's'} need attention{highCount > 0 ? ` (${highCount} urgent)` : ''}</span>
        <span style={styles.chevron}>{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <ul style={styles.list}>
          {alerts.map((a, i) => (
            <li key={i} style={styles.item}>
              <Link to={`/jobs/${a.jobId}`} style={styles.itemLink}>
                <span className={`gm-badge ${a.severity === 'high' ? 'gm-badge--brick' : 'gm-badge--honey'}`}>{a.jobNumber}</span>
                {' '}{a.message}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const styles = {
  wrap: { background: 'var(--gm-brick-soft)', borderRadius: 'var(--gm-radius)', marginBottom: 20, overflow: 'hidden' },
  header: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    background: 'none',
    border: 'none',
    textAlign: 'left',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--gm-brick)',
  },
  dot: { width: 7, height: 7, borderRadius: '50%', background: 'var(--gm-brick)', flexShrink: 0 },
  chevron: { marginLeft: 'auto', fontSize: 16 },
  list: { listStyle: 'none', margin: 0, padding: '0 16px 12px' },
  item: { fontSize: 13, padding: '4px 0', color: 'var(--gm-ink)' },
  itemLink: { color: 'inherit', textDecoration: 'none' },
};
