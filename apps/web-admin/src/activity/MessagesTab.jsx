import { useEffect, useState } from 'react';
import { fetchMessages } from './activityApi.js';

const STATUS_BADGE = {
  sent: 'gm-badge--forest',
  approved: 'gm-badge--forest',
  pending_approval: 'gm-badge--honey',
  claude_drafting: 'gm-badge--honey',
  claude_completed: 'gm-badge--honey',
  send_failed: 'gm-badge--brick',
  claude_failed: 'gm-badge--brick',
  validation_failed: 'gm-badge--brick',
  queued: 'gm-badge--honey',
};

export default function MessagesTab() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMessages().then(setMessages).catch(() => setMessages([])).finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={styles.empty}>Loading…</p>;
  if (messages.length === 0) {
    return (
      <p style={styles.empty}>
        No messages drafted yet. This is where AI-drafted quotes and replies show up once sent — SMS sending is currently blocked pending a passthrough template in MSG91 (see Settings).
      </p>
    );
  }

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id} className="gm-card" style={styles.row}>
          <div style={styles.rowHeader}>
            <span style={styles.channel}>{m.channel.toUpperCase()}</span>
            <span style={styles.to}>{m.to_address}</span>
            <span className={`gm-badge ${STATUS_BADGE[m.status] || 'gm-badge--forest'}`}>{m.status.replace(/_/g, ' ')}</span>
            <span style={styles.time}>{new Date(m.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
          </div>
          {m.draft_text && <p style={styles.text}>{m.draft_text}</p>}
          {m.error && <p style={styles.error}>{m.error}</p>}
        </div>
      ))}
    </div>
  );
}

const styles = {
  empty: { color: 'var(--gm-ink-soft)', fontSize: 13, maxWidth: 480 },
  row: { padding: '14px 16px', marginBottom: 8 },
  rowHeader: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  channel: { fontSize: 11, fontWeight: 700, color: 'var(--gm-forest-dark)', letterSpacing: 0.5 },
  to: { fontSize: 13, color: 'var(--gm-ink)' },
  time: { fontSize: 11, color: 'var(--gm-ink-soft)', marginLeft: 'auto' },
  text: { fontSize: 13, color: 'var(--gm-ink)', marginTop: 8, lineHeight: 1.5 },
  error: { fontSize: 12, color: 'var(--gm-brick)', marginTop: 8 },
};
