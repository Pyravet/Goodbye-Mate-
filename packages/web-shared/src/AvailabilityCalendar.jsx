import { useState, useMemo } from 'react';
import { isVetAvailableOnDate } from './availabilityHelpers.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (h) => `${String(Math.min(h, 23)).padStart(2, '0')}:00`;
const dayKeyOf = (key) => DAY_KEYS[new Date(`${key}T00:00:00`).getDay()];

/**
 * Availability: pick a date on the grid, then set the hours for it.
 *
 * A month grid is how people already read a calendar — you find the 14th
 * by looking, not by scrolling a list of every date in the month.
 *
 * Hours are stored as ranges to the MINUTE, so "1pm to 10:30pm" is
 * expressible. The old whole-day boolean couldn't say that, and the
 * weekly pattern works only in whole hours.
 */
export default function AvailabilityCalendar({ vet, onSetOverride, saving }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState([]);
  const [error, setError] = useState('');

  const overrides = vet?.date_overrides || {};
  const todayKey = new Date().toLocaleDateString('en-CA');

  const { label, cells } = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const year = base.getFullYear();
    const month = base.getMonth();
    const count = new Date(year, month + 1, 0).getDate();
    const leading = new Date(year, month, 1).getDay();

    const list = [];
    // Blank cells so the 1st lands under its real weekday — without
    // them every date sits in the wrong column.
    for (let i = 0; i < leading; i++) list.push(null);
    for (let d = 1; d <= count; d++) {
      // Built from local parts, not toISOString, which would shift the
      // day for anyone east of UTC and mislabel every date.
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      list.push({ key, dayNum: d });
    }
    return {
      label: base.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
      cells: list,
    };
  }, [monthOffset]);

  /** What's already set for a date, as editable ranges. */
  const rangesFor = (key) => {
    const existing = overrides[key];
    if (Array.isArray(existing)) return existing.map((r) => ({ ...r }));
    if (existing === false) return [];

    // Unset, or a whole-day override: seed from the weekly pattern so
    // the vet edits what they actually work rather than a blank slate.
    const dayHours = vet?.weekly_hours?.[dayKeyOf(key)] || {};
    const hours = Object.keys(dayHours).filter((h) => dayHours[h]).map(Number).sort((a, b) => a - b);
    if (hours.length === 0) return existing === true ? [{ start: '09:00', end: '17:00' }] : [];
    return [{ start: pad(hours[0]), end: pad(hours[hours.length - 1] + 1) }];
  };

  const pick = (key) => {
    setSelected(key);
    setDraft(rangesFor(key));
    setError('');
  };

  const save = async () => {
    for (const r of draft) {
      if (r.end <= r.start) {
        setError('A finish time must be after its start time.');
        return;
      }
    }
    setError('');
    // An empty list is saved as-is, meaning "not working this date" —
    // NOT cleared, which would silently restore the weekly pattern the
    // vet was overriding.
    await onSetOverride(selected, draft);
    setSelected(null);
  };

  return (
    <div>
      <div style={styles.header}>
        <button onClick={() => setMonthOffset((m) => m - 1)} style={styles.navBtn}>‹</button>
        <span style={styles.monthLabel}>{label}</span>
        <button onClick={() => setMonthOffset((m) => m + 1)} style={styles.navBtn}>›</button>
      </div>

      <div style={styles.weekRow}>
        {WEEKDAY_LABELS.map((d) => <div key={d} style={styles.weekLabel}>{d}</div>)}
      </div>

      <div style={styles.grid}>
        {cells.map((c, i) => {
          if (!c) return <div key={`blank-${i}`} />;
          const available = isVetAvailableOnDate(
            { weekly_hours: vet?.weekly_hours, date_overrides: overrides }, c.key
          );
          const isSet = overrides[c.key] !== undefined;
          const isPast = c.key < todayKey;
          return (
            <button
              key={c.key}
              onClick={() => !isPast && pick(c.key)}
              disabled={isPast}
              style={{
                ...styles.day,
                ...(available ? styles.dayAvailable : styles.dayOff),
                ...(selected === c.key ? styles.daySelected : {}),
                ...(isPast ? styles.dayPast : {}),
              }}
            >
              {c.dayNum}
              {/* A dot marks a date set deliberately, so an exception is
                  distinguishable from the usual weekly pattern. */}
              {isSet && <span style={styles.dot} />}
            </button>
          );
        })}
      </div>

      <p style={styles.legend}>
        Green means available. A dot means that date has been set specifically. Tap a date to
        change its hours — past dates aren&apos;t editable.
      </p>

      {selected && (
        <div style={styles.editor}>
          <div style={styles.editorHead}>
            <strong>
              {new Date(`${selected}T00:00:00`).toLocaleDateString('en-AU', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
            </strong>
            <button onClick={() => setSelected(null)} style={styles.closeBtn}>✕</button>
          </div>

          {error && <p style={styles.error}>{error}</p>}

          {draft.length === 0 && (
            <p style={styles.hint}>Not working this date. Add hours below to change that.</p>
          )}

          {draft.map((r, i) => (
            <div key={i} style={styles.rangeRow}>
              <input
                type="time"
                value={r.start}
                onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                style={styles.timeInput}
              />
              <span style={styles.dash}>—</span>
              <input
                type="time"
                value={r.end}
                onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                style={styles.timeInput}
              />
              <button
                onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                style={styles.deleteBtn}
                title="Remove these hours"
              >
                Remove
              </button>
            </div>
          ))}

          {/* Several ranges per day, for a vet working a morning and an
              evening with a break in between. */}
          <button
            onClick={() => setDraft([...draft, { start: '09:00', end: '17:00' }])}
            style={styles.addBtn}
          >
            + Add hours
          </button>

          <div style={styles.editorActions}>
            <button
              onClick={() => { onSetOverride(selected, null); setSelected(null); }}
              disabled={saving}
              style={styles.resetBtn}
            >
              Use usual hours
            </button>
            <button onClick={save} disabled={saving} style={styles.saveBtn}>
              {saving ? 'Saving…' : 'Save this date'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  navBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', width: 40, minHeight: 40, fontSize: 18, cursor: 'pointer' },
  monthLabel: { fontFamily: 'var(--gm-font-display)', fontSize: 17, fontWeight: 600 },
  weekRow: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 },
  weekLabel: { textAlign: 'center', fontSize: 11, color: 'var(--gm-ink-soft)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 },
  // 44px keeps every date a comfortable tap target on a phone.
  day: { position: 'relative', minHeight: 44, border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', background: '#fff', fontSize: 14, cursor: 'pointer' },
  dayAvailable: { background: '#E3E9E1', color: 'var(--gm-forest-dark)', fontWeight: 600 },
  dayOff: { background: '#fff', color: 'var(--gm-ink-soft)' },
  daySelected: { outline: '2px solid var(--gm-forest)', outlineOffset: -2 },
  dayPast: { opacity: 0.35, cursor: 'default' },
  dot: { position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: '#7A5A22' },
  legend: { fontSize: 11, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginTop: 10 },
  editor: { marginTop: 14, background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius)', padding: 14 },
  editorHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, fontSize: 15 },
  closeBtn: { background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--gm-ink-soft)' },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 10 },
  error: { fontSize: 12, color: 'var(--gm-brick)', marginBottom: 10 },
  rangeRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  timeInput: { flex: 1, minWidth: 0, minHeight: 44, padding: '8px 10px', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', fontSize: 15, fontFamily: 'inherit' },
  dash: { color: 'var(--gm-ink-soft)' },
  deleteBtn: { minHeight: 44, background: 'none', border: 'none', fontSize: 12, color: 'var(--gm-brick)', cursor: 'pointer', textDecoration: 'underline' },
  addBtn: { width: '100%', minHeight: 44, background: '#fff', border: '1px dashed var(--gm-forest)', color: 'var(--gm-forest)', borderRadius: 'var(--gm-radius-sm)', fontSize: 14, fontWeight: 500, cursor: 'pointer', marginBottom: 12 },
  editorActions: { display: 'flex', gap: 8 },
  resetBtn: { flex: 1, minHeight: 44, background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, cursor: 'pointer' },
  saveBtn: { flex: 1, minHeight: 44, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', fontSize: 14, fontWeight: 500, cursor: 'pointer' },
};
