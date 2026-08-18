import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import { fetchMyJobs } from '../jobs/jobsApi.js';
import { fetchMe, setDateOverride } from '../vets/vetsApi.js';
import WeeklyAvailability from '../vets/WeeklyAvailability.jsx';
import { formatTime as formatTime } from '@goodbye-mate/web-shared/src/format.js';

function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Calendar() {
  const [tab, setTab] = useState('calendar'); // 'calendar' | 'availability'
  const [anchor, setAnchor] = useState(new Date());
  const [jobs, setJobs] = useState([]);
  const [vet, setVet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(toDateKey(new Date()));
  const [overrideBusy, setOverrideBusy] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([fetchMyJobs('board'), fetchMe()])
      .then(([j, meData]) => { setJobs(j); setVet(meData.vet); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const jobsByDate = useMemo(() => {
    const map = {};
    for (const j of jobs) {
      const key = typeof j.job_date === 'string' ? j.job_date.slice(0, 10) : toDateKey(new Date(j.job_date));
      (map[key] ||= []).push(j);
    }
    for (const key in map) map[key].sort((a, b) => a.job_time.localeCompare(b.job_time));
    return map;
  }, [jobs]);

  const overrides = vet?.date_overrides || {};

  const shiftMonth = (dir) => {
    const next = new Date(anchor);
    next.setMonth(next.getMonth() + dir);
    setAnchor(next);
  };

  const onSetOverride = async (available) => {
    if (!vet) return;
    setOverrideBusy(true);
    try {
      await setDateOverride(vet.id, selected, available);
      load();
    } finally {
      setOverrideBusy(false);
    }
  };

  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = toDateKey(new Date());

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const selectedJobs = jobsByDate[selected] || [];
  const selectedOverride = overrides[selected]; // true | false | undefined

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Calendar</h1>

        <div style={styles.tabs}>
          <button onClick={() => setTab('calendar')} style={{ ...styles.tab, ...(tab === 'calendar' ? styles.tabActive : {}) }}>Calendar</button>
          <button onClick={() => setTab('availability')} style={{ ...styles.tab, ...(tab === 'availability' ? styles.tabActive : {}) }}>Weekly hours</button>
        </div>

        {tab === 'availability' ? (
          loading || !vet ? (
            <p style={styles.empty}>Loading…</p>
          ) : (
            <WeeklyAvailability vetId={vet.id} initialHours={vet.weekly_hours} />
          )
        ) : (
          <>
            <div style={styles.monthRow}>
              <button onClick={() => shiftMonth(-1)} style={styles.navBtn}>←</button>
              <div style={styles.monthTitle}>{firstOfMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</div>
              <button onClick={() => shiftMonth(1)} style={styles.navBtn}>→</button>
            </div>

            <div style={styles.weekdayRow}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} style={styles.weekdayLabel}>{d}</div>)}
            </div>

            <div style={styles.grid}>
              {cells.map((date, i) => {
                if (!date) return <div key={i} />;
                const key = toDateKey(date);
                const dayJobs = jobsByDate[key] || [];
                const override = overrides[key];
                const isToday = key === today;
                const isSelected = key === selected;
                return (
                  <button
                    key={i}
                    onClick={() => setSelected(key)}
                    style={{
                      ...styles.dayCell,
                      ...(isToday ? styles.dayCellToday : {}),
                      ...(isSelected ? styles.dayCellSelected : {}),
                      ...(override === false ? styles.dayCellBlocked : {}),
                    }}
                  >
                    <span style={styles.dayNum}>{date.getDate()}</span>
                    {dayJobs.length > 0 && <span style={styles.dayDot} />}
                  </button>
                );
              })}
            </div>

            <div style={styles.detailCard} className="gm-card">
              <div style={styles.detailHeader}>
                {new Date(selected + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>

              {loading ? (
                <p style={styles.empty}>Loading…</p>
              ) : (
                <>
                  {selectedJobs.length === 0 ? (
                    <p style={styles.empty}>No jobs on this date.</p>
                  ) : (
                    selectedJobs.map((j) => (
                      <Link key={j.id} to={`/jobs/${j.id}`} style={styles.jobRow}>
                        <span style={styles.jobTime}>{formatTime(j.job_time)}</span>
                        <span>{j.pet_name}</span>
                      </Link>
                    ))
                  )}

                  <div style={styles.overrideRow}>
                    <span style={styles.overrideLabel}>
                      {selectedOverride === false ? 'Marked unavailable' : selectedOverride === true ? 'Marked available' : 'Following your weekly pattern'}
                    </span>
                    <div style={styles.overrideBtns}>
                      <button onClick={() => onSetOverride(true)} disabled={overrideBusy} style={styles.overrideBtn}>Available</button>
                      <button onClick={() => onSetOverride(false)} disabled={overrideBusy} style={styles.overrideBtn}>Blocked</button>
                      {selectedOverride !== undefined && (
                        <button onClick={() => onSetOverride(null)} disabled={overrideBusy} style={styles.overrideBtnClear}>Clear</button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

const styles = {
  page: { padding: '20px 16px' },
  title: { fontSize: 22, marginBottom: 14 },
  tabs: { display: 'flex', gap: 4, background: 'var(--gm-line-soft)', padding: 3, borderRadius: 'var(--gm-radius-sm)', marginBottom: 16 },
  tab: { flex: 1, background: 'none', border: 'none', padding: '8px 0', borderRadius: 5, fontSize: 13, fontWeight: 500, color: 'var(--gm-ink-soft)' },
  tabActive: { background: '#fff', color: 'var(--gm-forest-dark)', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' },
  monthRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  monthTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 17, fontWeight: 600 },
  navBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '6px 14px', fontSize: 15 },
  weekdayRow: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 },
  weekdayLabel: { fontSize: 11, textTransform: 'uppercase', color: 'var(--gm-ink-soft)', textAlign: 'center' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 16 },
  dayCell: {
    aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 8, fontSize: 13, color: 'var(--gm-ink)',
  },
  dayCellToday: { borderColor: 'var(--gm-honey)', borderWidth: 2 },
  dayCellSelected: { background: 'var(--gm-forest)', color: '#fff', borderColor: 'var(--gm-forest)' },
  dayCellBlocked: { background: 'var(--gm-brick-soft)' },
  dayNum: { fontWeight: 500 },
  dayDot: { width: 5, height: 5, borderRadius: '50%', background: 'currentColor', marginTop: 2 },
  detailCard: { padding: 16 },
  detailHeader: { fontFamily: 'var(--gm-font-display)', fontSize: 15, fontWeight: 600, marginBottom: 10 },
  empty: { fontSize: 13, color: 'var(--gm-ink-soft)' },
  jobRow: { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', fontSize: 14, color: 'var(--gm-ink)', textDecoration: 'none', borderBottom: '1px solid var(--gm-line-soft)' },
  jobTime: { fontWeight: 600, color: 'var(--gm-forest-dark)', width: 60, flexShrink: 0 },
  overrideRow: { marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--gm-line)' },
  overrideLabel: { fontSize: 12, color: 'var(--gm-ink-soft)', display: 'block', marginBottom: 8 },
  overrideBtns: { display: 'flex', gap: 8 },
  overrideBtn: { flex: 1, background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '9px 0', fontSize: 13, fontWeight: 500 },
  overrideBtnClear: { background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '9px 12px', fontSize: 13, fontWeight: 500, color: 'var(--gm-ink-soft)' },
};
