import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fetchInternalInbox } from './activityApi.js';

export default function InboxTab() {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInternalInbox().then(setThreads).catch(() => setThreads([])).finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={styles.empty}>Loading…</p>;
  if (threads.length === 0) return <p style={styles.empty}>No messages with vets yet — they'll show up here as soon as one comes in.</p>;

  return (
    <div>
      {threads.map((t) => (
        <Link key={t.job_id} to={`/jobs/${t.job_id}`} style={styles.link}>
          <div className="gm-card" style={styles.row}>
            {t.admin_unread_messages && <span style={styles.unreadDot} title="Unread" />}
            <div style={styles.mainCol}>
              <div style={styles.topLine}>
                <span style={styles.petName}>{t.pet_name}</span>
                <span style={styles.jobNumber}>{t.job_number}</span>
              </div>
              <div style={styles.preview}>{t.last_sender_name}: {t.last_message}</div>
            </div>
            <div style={styles.time}>{new Date(t.last_message_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

const styles = {
  empty: { color: 'var(--gm-ink-soft)', fontSize: 13 },
  link: { textDecoration: 'none', color: 'inherit', display: 'block' },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', marginBottom: 6 },
  unreadDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--gm-brick)', flexShrink: 0 },
  mainCol: { flex: 1, minWidth: 0 },
  topLine: { display: 'flex', alignItems: 'baseline', gap: 8 },
  petName: { fontFamily: 'var(--gm-font-display)', fontSize: 15, fontWeight: 600 },
  jobNumber: { fontSize: 11, color: 'var(--gm-ink-soft)' },
  preview: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
  time: { fontSize: 11, color: 'var(--gm-ink-soft)', flexShrink: 0 },
};
