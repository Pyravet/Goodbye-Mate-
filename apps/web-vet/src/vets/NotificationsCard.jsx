import { useState, useEffect } from 'react';
import { fetchNotificationPrefs, saveNotificationPrefs } from './vetsApi.js';

const PAUSE_OPTIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: 'Until tomorrow', minutes: 12 * 60 },
  { label: 'A week', minutes: 7 * 24 * 60 },
];

/**
 * Pause new job offers, for a while.
 *
 * This existed only in the native app — a vet using the web app had no
 * way to pause at all, and the mobile-only feature request specifically
 * meant to give vets a break was silently half-delivered.
 *
 * Bounded rather than an on/off switch: it expires by itself, so it
 * can't be left off by accident the way an unsubscribe could.
 */
export default function NotificationsCard() {
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => fetchNotificationPrefs().then(setPrefs).catch(() => setPrefs({}));
  useEffect(() => { load(); }, []);

  const pause = async (minutes) => {
    setBusy(true);
    setError('');
    try {
      setPrefs(await saveNotificationPrefs({ pauseMinutes: minutes }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!prefs) return null;

  const pausedUntil = prefs.notifications_paused_until ? new Date(prefs.notifications_paused_until) : null;
  const isPaused = pausedUntil && pausedUntil > new Date();

  return (
    <div style={styles.card}>
      <h3 style={styles.title}>Notifications</h3>

      {error && <p style={styles.error}>{error}</p>}

      {isPaused ? (
        <>
          <p style={styles.pausedText}>
            Paused until {pausedUntil.toLocaleString('en-AU', {
              weekday: 'short', hour: 'numeric', minute: '2-digit',
            })}.
          </p>
          {/* Said plainly: a vet who thinks they've silenced everything
              and then misses a cancellation would rightly be annoyed —
              this is the behaviour that protects them, so it can't be
              left implicit. */}
          <p style={styles.hint}>
            Reminders and cancellations for jobs you&apos;ve already accepted will still come
            through. Only new offers are held back.
          </p>
          <button onClick={() => pause(0)} disabled={busy} style={styles.resumeBtn}>
            Turn notifications back on
          </button>
        </>
      ) : (
        <>
          <p style={styles.hint}>
            Pause new job offers for a while. It switches back on by itself, so you can&apos;t
            leave it off by accident.
          </p>
          <div style={styles.row}>
            {PAUSE_OPTIONS.map((o) => (
              <button
                key={o.minutes}
                onClick={() => pause(o.minutes)}
                disabled={busy}
                style={styles.pauseBtn}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  card: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius)', padding: 18, marginBottom: 16 },
  title: { fontFamily: 'var(--gm-font-display)', fontSize: 17, fontWeight: 600, marginBottom: 8 },
  hint: { fontSize: 13, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 12 },
  error: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 10 },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  pauseBtn: { minHeight: 40, padding: '0 14px', background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, cursor: 'pointer' },
  pausedText: { fontSize: 15, fontWeight: 600, color: '#7A5A22', marginBottom: 4 },
  resumeBtn: { minHeight: 44, padding: '0 18px', background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', fontSize: 14, fontWeight: 500, cursor: 'pointer' },
};
