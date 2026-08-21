import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import { fetchJobs } from '../jobs/jobsApi.js';
import { formatHourCompact as formatTime } from '@goodbye-mate/web-shared/src/format.js';
import { toDateKey } from '@goodbye-mate/web-shared/src/format.js';

const STATUS_COLOR = {
  available: 'var(--gm-brick)',
  assigned: 'var(--gm-forest)',
  in_route: 'var(--gm-forest)',
  started: 'var(--gm-honey)',
  completed: '#A8A296',
  cancelled: '#C9C2B4',
};

const STATUS_LABEL = {
  available: 'Needs a vet',
  assigned: 'Assigned',
  in_route: 'On the way',
  started: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_BADGE = {
  available: 'gm-badge--brick',
  assigned: 'gm-badge--forest',
  in_route: 'gm-badge--forest',
  started: 'gm-badge--honey',
  completed: '',
  cancelled: 'gm-badge--brick',
};



export default function CalendarPage() {
  const [view, setView] = useState('month'); // 'month' | 'week'
  const [anchor, setAnchor] = useState(new Date()); // any date within the visible period
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  // Which day's jobs are listed underneath. Defaults to today so the
  // screen is useful the moment it opens rather than after a click.
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));

  useEffect(() => {
    fetchJobs('board').then(setJobs).catch(() => setJobs([])).finally(() => setLoading(false));
  }, []);

  const jobsByDate = useMemo(() => {
    const map = {};
    for (const j of jobs) {
      const key = typeof j.job_date === 'string' ? j.job_date.slice(0, 10) : toDateKey(new Date(j.job_date));
      (map[key] ||= []).push(j);
    }
    for (const key in map) map[key].sort((a, b) => a.job_time.localeCompare(b.job_time));
    return map;
  }, [jobs]);

  const goToday = () => setAnchor(new Date());
  const shift = (dir) => {
    const next = new Date(anchor);
    if (view === 'month') next.setMonth(next.getMonth() + dir);
    else next.setDate(next.getDate() + dir * 7);
    setAnchor(next);
  };

  return (
    <AppShell>
      <div style={styles.page}>
        <div style={styles.headerRow}>
          <h1 style={styles.title}>Calendar</h1>
          <div style={styles.controls}>
            <div style={styles.viewToggle}>
              <button onClick={() => setView('month')} style={{ ...styles.viewBtn, ...(view === 'month' ? styles.viewBtnActive : {}) }}>Month</button>
              <button onClick={() => setView('week')} style={{ ...styles.viewBtn, ...(view === 'week' ? styles.viewBtnActive : {}) }}>Week</button>
            </div>
            <button onClick={() => shift(-1)} style={styles.navBtn}>←</button>
            <button onClick={goToday} style={styles.navBtn}>Today</button>
            <button onClick={() => shift(1)} style={styles.navBtn}>→</button>
          </div>
        </div>

        {loading ? (
          <p style={{ color: 'var(--gm-ink-soft)', fontSize: 13 }}>Loading…</p>
        ) : view === 'month' ? (
          <MonthView
            anchor={anchor}
            jobsByDate={jobsByDate}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
        ) : (
          <WeekView anchor={anchor} jobsByDate={jobsByDate} />
        )}

        {!loading && view === 'month' && (
          <DayList date={selectedDate} jobs={jobsByDate[selectedDate] || []} />
        )}
      </div>
    </AppShell>
  );
}

function MonthView({ anchor, jobsByDate, selectedDate, onSelectDate }) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = toDateKey(new Date());

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div style={styles.monthTitle}>{firstOfMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</div>
      <div style={styles.weekdayRow}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} style={styles.weekdayLabel}>{d}</div>)}
      </div>
      <div style={styles.monthGrid}>
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="gm-cal-day" style={styles.emptyCell} />;
          const key = toDateKey(date);
          const dayJobs = jobsByDate[key] || [];
          const isToday = key === today;
          return (
            <div
              key={i}
              className="gm-cal-day"
              onClick={() => onSelectDate(key)}
              style={{
                ...styles.dayCell,
                ...(isToday ? styles.dayCellToday : {}),
                ...(key === selectedDate ? styles.dayCellSelected : {}),
              }}
            >
              <div style={styles.dayNumber}>{date.getDate()}</div>
              <div style={styles.dayJobs}>
                {dayJobs.slice(0, 3).map((j) => (
                  <Link key={j.id} to={`/jobs/${j.id}`} style={styles.jobChip}>
                    <span style={{ ...styles.jobDot, background: STATUS_COLOR[j.status] }} />
                    {formatTime(j.job_time)} {j.pet_name}
                    {j.vet_name && <span style={styles.chipVet}> · {j.vet_name.split(' ')[0]}</span>}
                  </Link>
                ))}
                {dayJobs.length > 3 && <div style={styles.moreLabel}>+{dayJobs.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The day's jobs, listed in full beneath the grid.
 *
 * A month cell can only hold a couple of truncated chips, so the
 * calendar showed THAT something was booked without showing what: no
 * vet, no location, no client. This lists the selected day properly —
 * including who is attending and which state, since a nationwide roster
 * makes "3pm" ambiguous without knowing the timezone it's in.
 */
function DayList({ date, jobs }) {
  const label = new Date(`${date}T00:00:00`).toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div style={styles.dayListWrap}>
      <h2 style={styles.dayListTitle}>{label}</h2>

      {jobs.length === 0 ? (
        <p style={styles.dayListEmpty}>Nothing booked on this day.</p>
      ) : (
        jobs.map((j) => (
          <Link key={j.id} to={`/jobs/${j.id}`} className="gm-card" style={styles.dayRow}>
            <div style={styles.dayTime}>
              {formatTime(j.job_time)}
              {j.job_time_end && (
                <span style={styles.dayTimeEnd}>–{formatTime(j.job_time_end)}</span>
              )}
            </div>

            <div style={styles.dayMain}>
              <div style={styles.dayPet}>
                {j.pet_name}
                <span style={styles.dayClient}> · {j.client_name}</span>
              </div>
              <div style={styles.dayMeta}>
                {/* State is shown explicitly: with vets across multiple
                    states, a bare time is ambiguous. */}
                {[j.suburb, j.state, j.postcode].filter(Boolean).join(' ')}
              </div>
              <div style={styles.dayVet}>
                {j.vet_name
                  ? `Vet: ${j.vet_name}`
                  : j.dispatch_state === 'offered'
                    ? 'Offered — awaiting a vet'
                    : 'No vet assigned yet'}
              </div>
            </div>

            <span className={`gm-badge ${STATUS_BADGE[j.status] || ''}`}>
              {STATUS_LABEL[j.status] || j.status}
            </span>
          </Link>
        ))
      )}
    </div>
  );
}

function WeekView({ anchor, jobsByDate }) {
  const startOfWeek = new Date(anchor);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    return d;
  });
  const hours = Array.from({ length: 16 }, (_, i) => i + 6); // 6am–9pm
  const today = toDateKey(new Date());

  return (
    <div className="gm-cal-weekscroll" style={styles.weekWrap}>
      <div style={styles.weekHeaderRow}>
        <div style={styles.weekHourGutter} />
        {days.map((d) => {
          const key = toDateKey(d);
          return (
            <div key={key} style={{ ...styles.weekDayHeader, ...(key === today ? styles.weekDayHeaderToday : {}) }}>
              <div style={styles.weekDayName}>{d.toLocaleDateString('en-AU', { weekday: 'short' })}</div>
              <div style={styles.weekDayNum}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>
      <div style={styles.weekBody}>
        {hours.map((hour) => (
          <div key={hour} style={styles.weekHourRow}>
            <div style={styles.weekHourLabel}>{formatTime(`${hour}:00`)}</div>
            {days.map((d) => {
              const key = toDateKey(d);
              const hourJobs = (jobsByDate[key] || []).filter((j) => Number(j.job_time.split(':')[0]) === hour);
              return (
                <div key={key} style={styles.weekHourCell}>
                  {hourJobs.map((j) => (
                    <Link key={j.id} to={`/jobs/${j.id}`} style={{ ...styles.weekJobBlock, background: STATUS_COLOR[j.status] }}>
                      {j.pet_name}
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  dayCellSelected: { outline: '2px solid var(--gm-forest)', outlineOffset: -2 },
  chipVet: { opacity: 0.75 },
  dayListWrap: { marginTop: 24 },
  dayListTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 18, fontWeight: 600, marginBottom: 12 },
  dayListEmpty: { fontSize: 13, color: 'var(--gm-ink-soft)' },
  dayRow: { display: 'flex', alignItems: 'flex-start', gap: 14, padding: 14, marginBottom: 8, textDecoration: 'none', color: 'inherit' },
  dayTime: { fontFamily: 'var(--gm-font-display)', fontSize: 15, fontWeight: 600, minWidth: 92, flexShrink: 0 },
  dayTimeEnd: { fontSize: 12, color: 'var(--gm-ink-soft)', fontWeight: 400 },
  dayMain: { flex: 1, minWidth: 0 },
  dayPet: { fontSize: 15, fontWeight: 600 },
  dayClient: { fontWeight: 400, color: 'var(--gm-ink-soft)', fontSize: 13 },
  dayMeta: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  dayVet: { fontSize: 12, color: 'var(--gm-forest)', marginTop: 3, fontWeight: 500 },
  page: { padding: '32px 40px', maxWidth: 1100 },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 26 },
  controls: { display: 'flex', alignItems: 'center', gap: 8 },
  viewToggle: { display: 'flex', gap: 4, background: 'var(--gm-line-soft)', padding: 3, borderRadius: 'var(--gm-radius-sm)', marginRight: 8 },
  viewBtn: { background: 'none', border: 'none', padding: '6px 14px', borderRadius: 5, fontSize: 13, fontWeight: 500, color: 'var(--gm-ink-soft)' },
  viewBtnActive: { background: '#fff', color: 'var(--gm-forest-dark)', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' },
  navBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '6px 12px', fontSize: 13, fontWeight: 500, color: 'var(--gm-ink)' },

  monthTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 18, fontWeight: 600, marginBottom: 12 },
  weekdayRow: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 },
  weekdayLabel: { fontSize: 11, textTransform: 'uppercase', color: 'var(--gm-ink-soft)', textAlign: 'center', padding: '4px 0' },
  monthGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 },
  emptyCell: { minHeight: 92 },
  dayCell: { minHeight: 92, background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 8, padding: 6 },
  dayCellToday: { borderColor: 'var(--gm-honey)', borderWidth: 2 },
  dayNumber: { fontSize: 12, fontWeight: 600, color: 'var(--gm-ink-soft)', marginBottom: 4 },
  dayJobs: { display: 'flex', flexDirection: 'column', gap: 2 },
  jobChip: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--gm-ink)',
    textDecoration: 'none', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
  },
  jobDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  moreLabel: { fontSize: 10, color: 'var(--gm-ink-soft)' },

  weekWrap: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 10, overflow: 'hidden' },
  weekHeaderRow: { display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', borderBottom: '1px solid var(--gm-line)' },
  weekHourGutter: {},
  weekDayHeader: { textAlign: 'center', padding: '10px 4px', borderLeft: '1px solid var(--gm-line-soft)' },
  weekDayHeaderToday: { background: 'var(--gm-honey-soft)' },
  weekDayName: { fontSize: 11, textTransform: 'uppercase', color: 'var(--gm-ink-soft)' },
  weekDayNum: { fontFamily: 'var(--gm-font-display)', fontSize: 16, fontWeight: 600, marginTop: 2 },
  weekBody: { maxHeight: 600, overflowY: 'auto' },
  weekHourRow: { display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', borderBottom: '1px solid var(--gm-line-soft)' },
  weekHourLabel: { fontSize: 10, color: 'var(--gm-ink-soft)', textAlign: 'right', paddingRight: 8, paddingTop: 6 },
  weekHourCell: { borderLeft: '1px solid var(--gm-line-soft)', minHeight: 34, padding: 2, display: 'flex', flexDirection: 'column', gap: 2 },
  weekJobBlock: { fontSize: 10, color: '#fff', borderRadius: 4, padding: '2px 4px', textDecoration: 'none', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
};
