import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../layout/AppShell.jsx';
import { fetchJobs } from '../jobs/jobsApi.js';

const STATUS_COLOR = {
  available: 'var(--gm-brick)',
  assigned: 'var(--gm-forest)',
  in_route: 'var(--gm-forest)',
  started: 'var(--gm-honey)',
  completed: '#A8A296',
  cancelled: '#C9C2B4',
};

function formatTime(t) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${period}`;
}

function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CalendarPage() {
  const [view, setView] = useState('month'); // 'month' | 'week'
  const [anchor, setAnchor] = useState(new Date()); // any date within the visible period
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

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
          <MonthView anchor={anchor} jobsByDate={jobsByDate} />
        ) : (
          <WeekView anchor={anchor} jobsByDate={jobsByDate} />
        )}
      </div>
    </AppShell>
  );
}

function MonthView({ anchor, jobsByDate }) {
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
          if (!date) return <div key={i} style={styles.emptyCell} />;
          const key = toDateKey(date);
          const dayJobs = jobsByDate[key] || [];
          const isToday = key === today;
          return (
            <div key={i} style={{ ...styles.dayCell, ...(isToday ? styles.dayCellToday : {}) }}>
              <div style={styles.dayNumber}>{date.getDate()}</div>
              <div style={styles.dayJobs}>
                {dayJobs.slice(0, 3).map((j) => (
                  <Link key={j.id} to={`/jobs/${j.id}`} style={styles.jobChip}>
                    <span style={{ ...styles.jobDot, background: STATUS_COLOR[j.status] }} />
                    {formatTime(j.job_time)} {j.pet_name}
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
    <div style={styles.weekWrap}>
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
