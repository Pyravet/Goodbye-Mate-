import { useState, Fragment } from 'react';
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
  return `${h12}${period}`;
}

export default function WeeklyAvailabilityGrid({ vetId, initialHours }) {
  const [hours, setHours] = useState(initialHours || {});
  const [saving, setSaving] = useState(false);
  const [dragValue, setDragValue] = useState(null); // true/false while dragging, null when not dragging

  const isOn = (day, hour) => !!hours[day]?.[hour];

  const setCell = (day, hour, value) => {
    setHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], [hour]: value },
    }));
  };

  const onMouseDown = (day, hour) => {
    const next = !isOn(day, hour);
    setDragValue(next);
    setCell(day, hour, next);
  };
  const onMouseEnter = (day, hour) => {
    if (dragValue === null) return;
    setCell(day, hour, dragValue);
  };
  const onMouseUp = async () => {
    if (dragValue === null) return;
    setDragValue(null);
    setSaving(true);
    try {
      await updateWeeklyHours(vetId, hours);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onMouseUp={onMouseUp} onMouseLeave={() => dragValue !== null && onMouseUp()}>
      <div style={styles.grid}>
        <div />
        {DAYS.map((d) => <div key={d.key} style={styles.dayHeader}>{d.label}</div>)}
        {HOURS.map((hour) => (
          <Fragment key={hour}>
            <div style={styles.hourLabel}>{formatHour(hour)}</div>
            {DAYS.map((d) => (
              <div
                key={`${d.key}-${hour}`}
                onMouseDown={() => onMouseDown(d.key, hour)}
                onMouseEnter={() => onMouseEnter(d.key, hour)}
                style={{ ...styles.cell, background: isOn(d.key, hour) ? 'var(--gm-forest)' : 'var(--gm-line-soft)' }}
              />
            ))}
          </Fragment>
        ))}
      </div>
      <p style={styles.hint}>{saving ? 'Saving…' : 'Click or drag to toggle available hours.'}</p>
    </div>
  );
}

const styles = {
  grid: { display: 'grid', gridTemplateColumns: '44px repeat(7, 1fr)', gap: 2, userSelect: 'none' },
  dayHeader: { fontSize: 11, color: 'var(--gm-ink-soft)', textAlign: 'center', paddingBottom: 4 },
  hourLabel: { fontSize: 10, color: 'var(--gm-ink-soft)', textAlign: 'right', paddingRight: 6, lineHeight: '18px' },
  cell: { height: 18, borderRadius: 3, cursor: 'pointer' },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 10 },
};
