import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { checkDuplicate } from './jobsApi.js';

const LEVEL_COPY = {
  high: {
    title: 'This looks like a booking that already exists',
    tone: 'high',
  },
  medium: {
    title: 'A similar booking exists for this pet',
    tone: 'medium',
  },
  low: {
    title: 'This client has another booking',
    tone: 'low',
  },
};

/**
 * Warns when a booking being created looks like one that already exists.
 *
 * A duplicate means two vets dispatched to one grieving family, two
 * charges, and two sets of paperwork for one pet. It happens easily: a
 * distressed person rings and also submits the web form, or a family
 * member books without knowing someone else already has.
 *
 * Deliberately ADVISORY. Two genuinely separate bookings for one
 * household do happen — a second pet, or a rebooking after a
 * cancellation — and blocking those would be worse than a warning
 * someone can read and dismiss.
 */
export default function DuplicateWarning({ clientName, clientPhone, clientEmail, petName, date, excludeJobId }) {
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    // Nothing to match on yet.
    if (!clientPhone && !clientEmail) {
      setMatches([]);
      return undefined;
    }

    // Debounced: this fires while someone is still typing a phone
    // number, and checking on every keystroke would both hammer the API
    // and flash warnings against half-entered numbers.
    const t = setTimeout(() => {
      checkDuplicate({ clientName, clientPhone, clientEmail, petName, date, excludeJobId })
        .then((d) => setMatches(d.matches || []))
        .catch(() => setMatches([]));
    }, 600);
    return () => clearTimeout(t);
  }, [clientName, clientPhone, clientEmail, petName, date, excludeJobId]);

  if (matches.length === 0) return null;

  const top = matches[0];
  const copy = LEVEL_COPY[top.level] || LEVEL_COPY.low;

  return (
    <div style={{ ...styles.box, ...styles[copy.tone] }}>
      <div style={styles.title}>{copy.title}</div>

      {matches.slice(0, 3).map((m) => (
        <div key={m.jobId} style={styles.match}>
          <Link to={`/jobs/${m.jobId}`} style={styles.link}>
            {m.jobNumber} · {m.petName} · {new Date(`${String(m.jobDate).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
          </Link>
          <div style={styles.reasons}>
            {m.reasons.join(', ')}
            {m.hasVet && ' · a vet is already assigned'}
            {m.status === 'completed' && ' · already completed'}
          </div>
        </div>
      ))}

      <p style={styles.hint}>
        {top.level === 'high'
          ? 'Check the existing booking before creating another — two bookings means two vets sent to the same family.'
          : 'You can still go ahead; this is just a heads-up.'}
      </p>
    </div>
  );
}

const styles = {
  box: { borderRadius: 'var(--gm-radius-sm)', padding: '12px 14px', marginBottom: 14 },
  high: { background: 'var(--gm-brick-soft, #F5E3E0)', border: '1px solid var(--gm-brick)' },
  medium: { background: 'var(--gm-honey-soft)', border: '1px solid transparent' },
  low: { background: 'var(--gm-line-soft)', border: '1px solid transparent' },
  title: { fontSize: 14, fontWeight: 600, marginBottom: 8 },
  match: { marginBottom: 8 },
  link: { fontSize: 13, fontWeight: 500, color: 'var(--gm-forest)', textDecoration: 'underline' },
  reasons: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 2 },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', lineHeight: 1.5, margin: 0 },
};
