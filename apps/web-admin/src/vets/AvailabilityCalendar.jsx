import { useState, useMemo } from 'react';
import { isVetAvailableOnDate } from './availabilityHelpers.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Availability as actual dates, month by month.
 *
 * The weekly grid answers "which hours does this vet normally work".
 * It can't answer "is she free on the 14th", which is the question
 * anyone actually has when looking at a vet — and it gave no way to see
 * or set a single date.
 *
 * The backend has supported per-date overrides since dispatch was
 * written (date_overrides, keyed YYYY-MM-DD); nothing in admin ever
 * exposed them.
 */
export default function AvailabilityCalendar({ vet, onSetOverride, saving }) {
  const [monthOffset, setMonthOffset] = useState(0);

  const { label, days } = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const year = base.getFullYear();
    const month = base.getMonth();
    const count = new Date(year, month + 1, 0).getDate();

    const list = [];
    for (let d = 1; d <= count; d++) {
      const date = new Date(year, month, d);
      // Built from local parts rather than toISOString, which would
      // shift the day for anyone east of UTC and label dates wrongly.
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      list.push({
        key,
        dayNum: d,
        weekday: date.toLocaleDateString('en-AU', { weekday: 'short' }),
        dayKey: DAY_KEYS[date.getDay()],
        isPast: key < new Date().toLocaleDateString('en-CA'),
      });
    }
    return {
      label: base.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
      days: list,
    };
  }, [monthOffset]);

  const overrides = vet?.date_overrides || {};

  return (
    <div>
      <div style={styles.header}>
        <button onClick={() => setMonthOffset((m) => m - 1)} style={styles.navBtn}>‹</button>
        <span style={styles.monthLabel}>{label}</span>
        <button onClick={() => setMonthOffset((m) => m + 1)} style={styles.navBtn}>›</button>
      </div>

      <p style={styles.hint}>
        Shows what this vet&apos;s weekly hours work out to on real dates. Setting a date here
        overrides those hours for that day only — for longer absences use Leave, which also
        tells dispatch not to offer them work.
      </p>

      {days.map((d) => {
        const override = overrides[d.key];
        const hours = vet?.weekly_hours?.[d.dayKey] || {};
        const available = isVetAvailableOnDate(
          { weekly_hours: vet?.weekly_hours, date_overrides: overrides }, d.key
        );
        const hourList = Object.keys(hours).filter((h) => hours[h]).map(Number).sort((a, b) => a - b);

        return (
          <div key={d.key} style={{ ...styles.row, ...(d.isPast ? styles.rowPast : {}) }}>
            <div style={styles.dateCol}>
              <div style={styles.weekday}>{d.weekday.toUpperCase()}</div>
              <div style={styles.dayNum}>{d.dayNum}</div>
            </div>

            <div style={{ ...styles.card, ...(available ? styles.cardAvailable : styles.cardOff) }}>
              <div style={available ? styles.availableText : styles.offText}>
                {available ? 'Available' : 'Unavailable'}
                {override !== undefined && <span style={styles.overrideTag}> · set for this date</span>}
              </div>
              <div style={styles.hoursText}>
                {available
                  ? (override === true && hourList.length === 0
                      ? 'All day'
                      : formatHours(hourList))
                  : 'All day'}
              </div>
            </div>

            {/* Past dates are shown for context but not editable — changing
                whether someone was free last Tuesday achieves nothing and
                risks confusing the record. */}
            {!d.isPast && (
              <div style={styles.actions}>
                <button
                  onClick={() => onSetOverride(d.key, override === false ? undefined : false)}
                  disabled={saving}
                  style={{ ...styles.actionBtn, ...(override === false ? styles.actionOn : {}) }}
                  title="Mark unavailable for this date"
                >
                  Off
                </button>
                <button
                  onClick={() => onSetOverride(d.key, override === true ? undefined : true)}
                  disabled={saving}
                  style={{ ...styles.actionBtn, ...(override === true ? styles.actionOn : {}) }}
                  title="Mark available for this date"
                >
                  On
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** "9am – 5pm", or the individual hours when they aren't contiguous. */
function formatHours(hours) {
  if (hours.length === 0) return 'No hours set';
  const label = (h) => {
    const suffix = h >= 12 ? 'pm' : 'am';
    const display = h % 12 === 0 ? 12 : h % 12;
    return `${display}${suffix}`;
  };
  const contiguous = hours.every((h, i) => i === 0 || h === hours[i - 1] + 1);
  // Non-contiguous hours listed individually rather than as a range —
  // showing "9am–5pm" for someone working 9–11 and 3–5 would send a vet
  // an offer at midday.
  return contiguous
    ? `${label(hours[0])} – ${label(hours[hours.length - 1] + 1)}`
    : hours.map(label).join(', ');
}

const styles = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', marginBottom: 8 },
  navBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', width: 40, minHeight: 40, fontSize: 18, cursor: 'pointer' },
  monthLabel: { fontFamily: 'var(--gm-font-display)', fontSize: 17, fontWeight: 600 },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 14 },
  row: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 },
  rowPast: { opacity: 0.45 },
  dateCol: { width: 44, textAlign: 'center', flexShrink: 0 },
  weekday: { fontSize: 10, color: 'var(--gm-ink-soft)', letterSpacing: 0.5 },
  dayNum: { fontSize: 20, fontWeight: 600, lineHeight: 1.1 },
  card: { flex: 1, borderRadius: 'var(--gm-radius-sm)', padding: '10px 12px', border: '1px solid var(--gm-line)', minWidth: 0 },
  cardAvailable: { background: '#fff' },
  cardOff: { background: 'var(--gm-line-soft)' },
  availableText: { fontSize: 14, fontWeight: 600, color: 'var(--gm-forest)' },
  offText: { fontSize: 14, fontWeight: 500, color: 'var(--gm-ink-soft)' },
  overrideTag: { fontSize: 11, fontWeight: 400, color: '#7A5A22' },
  hoursText: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  actions: { display: 'flex', gap: 4, flexShrink: 0 },
  actionBtn: { minWidth: 40, minHeight: 40, background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', fontSize: 12, cursor: 'pointer' },
  actionOn: { background: 'var(--gm-forest)', color: '#fff', borderColor: 'var(--gm-forest)' },
};
