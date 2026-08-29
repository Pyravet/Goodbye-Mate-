import { useState, useEffect, useCallback } from 'react';
import { AvailabilityCalendar } from '@goodbye-mate/web-shared';
import AppShell from '../layout/AppShell.jsx';
import { fetchMe, setDateOverride } from './vetsApi.js';
import WeeklyAvailability from './WeeklyAvailability.jsx';

/**
 * A vet's own availability — the same calendar admin sees.
 *
 * Deliberately the SAME component, not a copy. Two calendars would drift,
 * and a vet seeing different availability from the office is how someone
 * gets offered a job on a day they've blocked out.
 *
 * It matters most that the vet can set this themselves: dispatch now
 * excludes anyone marked unavailable, so an out-of-date pattern silently
 * costs them work.
 */
export default function AvailabilityPage() {
  const [vet, setVet] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    // fetchMe returns { vet, bankDetails } — the calendar needs the vet.
    fetchMe()
      .then((data) => setVet(data.vet))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSetOverride = async (date, value) => {
    setSaving(true);
    setError('');
    try {
      await setDateOverride(vet.id, date, value);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Your availability</h1>
        <p style={styles.intro}>
          You&apos;ll only be offered jobs during the hours you&apos;re available. Tap a date to
          set different hours just for that day.
        </p>

        {error && <p style={styles.error}>{error}</p>}

        {!vet ? (
          <p style={styles.hint}>Loading…</p>
        ) : (
          <>
            <AvailabilityCalendar vet={vet} onSetOverride={onSetOverride} saving={saving} />

            <h2 style={styles.sectionTitle}>Your usual weekly hours</h2>
            <p style={styles.hint}>
              The pattern the dates above follow, unless you&apos;ve set a date specifically.
            </p>
            <WeeklyAvailability vetId={vet.id} initialHours={vet.weekly_hours} />
          </>
        )}
      </div>
    </AppShell>
  );
}

const styles = {
  page: { padding: '18px 16px 40px', maxWidth: 560, margin: '0 auto' },
  title: { fontSize: 22, marginBottom: 6 },
  intro: { fontSize: 13, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 18 },
  sectionTitle: { fontSize: 16, fontWeight: 600, marginTop: 28, marginBottom: 4 },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 12 },
  error: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 12 },
};
