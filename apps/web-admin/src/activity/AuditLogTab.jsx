import { useEffect, useState } from 'react';
import { fetchAuditLog } from './activityApi.js';

const ACTION_LABELS = {
  login_success: 'Signed in',
  job_created: 'Booking created',
  job_manually_assigned: 'Vet manually assigned',
  dispatch_accepted: 'Vet accepted offer',
  dispatch_declined: 'Vet declined offer',
  vet_created: 'Vet added',
  vet_signup: 'Vet application submitted',
  vet_approved: 'Vet approved',
  vet_deactivated: 'Vet deactivated',
  vet_profile_updated: 'Vet profile updated',
  payment_succeeded: 'Payment received',
  payment_failed: 'Payment declined',
  document_emailed: 'Document emailed',
  message_approved_and_sent: 'Message sent',
};

function formatAction(action) {
  return ACTION_LABELS[action] || action.replace(/_/g, ' ');
}

function formatMetadata(metadata) {
  if (!metadata) return null;
  const entries = Object.entries(metadata);
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}: ${v}`).join(' · ');
}

export default function AuditLogTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAuditLog().then(setEntries).catch(() => setEntries([])).finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={styles.empty}>Loading…</p>;
  if (entries.length === 0) return <p style={styles.empty}>No activity recorded yet.</p>;

  return (
    <div>
      {entries.map((e) => (
        <div key={e.id} className="gm-card" style={styles.row}>
          <div style={styles.rowMain}>
            <span style={styles.action}>{formatAction(e.action)}</span>
            {e.target_type && <span style={styles.target}> · {e.target_type}{e.target_id ? ` ${String(e.target_id).slice(0, 8)}` : ''}</span>}
            {formatMetadata(e.metadata) && <div style={styles.metadata}>{formatMetadata(e.metadata)}</div>}
          </div>
          <div style={styles.rowMeta}>
            <div style={styles.actor}>{e.actor_name || 'System'}</div>
            <div style={styles.time}>{new Date(e.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const styles = {
  empty: { color: 'var(--gm-ink-soft)', fontSize: 13 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '12px 16px', marginBottom: 6 },
  rowMain: { flex: 1, minWidth: 0 },
  action: { fontSize: 13, fontWeight: 600, color: 'var(--gm-ink)' },
  target: { fontSize: 13, color: 'var(--gm-ink-soft)' },
  metadata: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  rowMeta: { textAlign: 'right', flexShrink: 0 },
  actor: { fontSize: 12, fontWeight: 500, color: 'var(--gm-ink)' },
  time: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 2 },
};
