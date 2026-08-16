import { useState } from 'react';
import { updateWeeklyHours } from './vetsApi.js';

const DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am – 9pm

function formatHour(h) {
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00${period}`;
}

// Tap-based (not drag-based) since this runs on touch devices — a day-tab
// plus a vertical list of hour toggles reads much better on a phone than
// trying to cram a 7×16 grid into a narrow viewport.
export default function WeeklyAvailability({ vetId, initialHours }) {
  const [hours, setHours] = useState(initialHours || {});
  const [day, setDay] = useState('mon');
  const [saving, setSaving] = useState(false);

  const isOn = (d, h) => !!hours[d]?.[h];

  const toggle = async (h) => {
    const next = { ...hours, [day]: { ...hours[day], [h]: !isOn(day, h) } };
    setHours(next);
    setSaving(true);
    try {
      await updateWeeklyHours(vetId, next);
    } finally {
      setSaving(false);
    }
  };

  const setWholeDay = async (value) => {
    const dayHours = {};
    HOURS.forEach((h) => { dayHours[h] = value; });
    const next = { ...hours, [day]: dayHours };
    setHours(next);
    setSaving(true);
    try {
      await updateWeeklyHours(vetId, next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={styles.dayTabs}>
        {DAYS.map((d) => (
          <button
            key={d.key}
            onClick={() => setDay(d.key)}
            style={{ ...styles.dayTab, ...(day === d.key ? styles.dayTabActive : {}) }}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div style={styles.quickRow}>
        <button onClick={() => setWholeDay(true)} style={styles.quickBtn}>Mark whole day available</button>
        <button onClick={() => setWholeDay(false)} style={styles.quickBtn}>Clear whole day</button>
      </div>

      <div style={styles.hourList}>
        {HOURS.map((h) => (
          <button
            key={h}
            onClick={() => toggle(h)}
            style={{ ...styles.hourRow, ...(isOn(day, h) ? styles.hourRowOn : {}) }}
          >
            <span>{formatHour(h)}</span>
            <span style={styles.hourState}>{isOn(day, h) ? 'Available' : 'Unavailable'}</span>
          </button>
        ))}
      </div>

      <p style={styles.hint}>{saving ? 'Saving…' : 'This is your recurring weekly pattern. Use the calendar for one-off exceptions on a specific date.'}</p>
    </div>
  );
}

const styles = {
  dayTabs: { display: 'flex', gap: 4, background: 'var(--gm-line-soft)', padding: 3, borderRadius: 'var(--gm-radius-sm)', marginBottom: 14 },
  dayTab: { flex: 1, background: 'none', border: 'none', padding: '8px 0', borderRadius: 5, fontSize: 13, fontWeight: 500, color: 'var(--gm-ink-soft)' },
  dayTabActive: { background: '#fff', color: 'var(--gm-forest-dark)', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' },
  quickRow: { display: 'flex', gap: 8, marginBottom: 14 },
  quickBtn: { flex: 1, background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '8px 6px', fontSize: 12, fontWeight: 500, color: 'var(--gm-ink)' },
  hourList: { display: 'flex', flexDirection: 'column', gap: 6 },
  hourRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 14px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)',
    background: '#fff', fontSize: 14, fontWeight: 500, color: 'var(--gm-ink)',
  },
  hourRowOn: { background: 'var(--gm-forest)', borderColor: 'var(--gm-forest)', color: '#fff' },
  hourState: { fontSize: 12, fontWeight: 500, opacity: 0.85 },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 14, lineHeight: 1.5 },
};
