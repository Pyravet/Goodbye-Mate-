import { Link } from 'react-router';
import { jobStatusBadges, jobStatusTone } from '@goodbye-mate/web-shared';
import { formatTime as formatTime } from '@goodbye-mate/web-shared/src/format.js';

const STATUS_LABELS = {
  available: 'Needs a vet',
  assigned: 'Assigned',
  in_route: 'On the way',
  started: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_BADGE_CLASS = {
  available: 'gm-badge--brick',
  assigned: 'gm-badge--forest',
  in_route: 'gm-badge--forest',
  started: 'gm-badge--honey',
  completed: 'gm-badge--forest',
  cancelled: 'gm-badge--brick',
};


export default function JobCard({ job, showDate }) {
  return (
    <Link to={`/jobs/${job.id}`} style={styles.link}>
      <div
        className="gm-card"
        style={{
          ...styles.card,
          // Scannable at arm's length. Redundant with the badges by
          // design — the stripe finds the row, the words explain it.
          borderLeft: `4px solid var(--gm-${jobStatusTone(job)})`,
        }}
      >
        <div style={styles.timeCol}>
          <div style={styles.time}>{formatTime(job.job_time)}</div>
          {showDate && <div style={styles.date}>{new Date(job.job_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</div>}
        </div>
        <div style={styles.mainCol}>
          <div style={styles.petRow}>
            <span style={styles.petName}>{job.pet_names || job.pet_name}</span>
            {job.pet_behaviour && job.pet_behaviour !== 'Friendly' && (
              <span className="gm-badge gm-badge--honey">{job.pet_behaviour}</span>
            )}
            {job.admin_unread_messages && <span style={styles.unreadDot} title="New message" />}
          </div>
          <div style={styles.clientLine}>{job.client_name} · {job.suburb || job.postcode}</div>
        </div>
        <div style={styles.statusCol}>
          <span className={`gm-badge ${STATUS_BADGE_CLASS[job.status]}`}>{STATUS_LABELS[job.status]}</span>
          {/* Readiness, which is a different question from dispatch
              state: the dispatch badge says whether a vet has it, these
              say whether the visit can actually go ahead. Shared with
              the vet app so the two can't disagree. */}
          {jobStatusBadges(job)
            .filter((b) => b.tone === 'brick')
            .map((b) => (
              <span
                key={b.label}
                className={`gm-badge gm-badge--${b.tone}`}
                style={{ marginTop: 4 }}
              >
                {b.label}
              </span>
            ))}
          {job.dispatch_state === 'unassigned' && (
            <span className="gm-badge gm-badge--brick" style={{ marginTop: 4 }}>Needs manual assign</span>
          )}
        </div>
      </div>
    </Link>
  );
}

const styles = {
  link: { textDecoration: 'none', color: 'inherit', display: 'block' },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '14px 18px',
    marginBottom: 8,
    transition: 'border-color 0.15s',
  },
  timeCol: { width: 64, flexShrink: 0 },
  time: { fontFamily: 'var(--gm-font-display)', fontSize: 16, fontWeight: 600, color: 'var(--gm-forest-dark)' },
  date: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 2 },
  mainCol: { flex: 1, minWidth: 0 },
  petRow: { display: 'flex', alignItems: 'center', gap: 8 },
  unreadDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--gm-brick)', flexShrink: 0 },
  petName: { fontFamily: 'var(--gm-font-display)', fontSize: 16, fontWeight: 600 },
  clientLine: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 2 },
  statusCol: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 },
};
