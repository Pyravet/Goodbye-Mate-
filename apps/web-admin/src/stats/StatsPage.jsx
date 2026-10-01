import { useState, useEffect, useCallback } from 'react';
import AppShell from '../layout/AppShell.jsx';
import { fetchStats, downloadStatsCsv } from './statsApi.js';

const PRESETS = [
  { label: 'Last 3 months', months: 3 },
  { label: 'Last 6 months', months: 6 },
  { label: 'Last 12 months', months: 12 },
  { label: 'This year', calendarYear: true },
];

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function startOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

function money(n) {
  return `$${Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Business performance dashboard: jobs and revenue over time, by
 * location and by vet, with a CSV export of the underlying rows.
 *
 * Every figure here comes from the SAME pricing calculation used for
 * client invoices and vet RCTIs — nothing is reimplemented, so these
 * numbers can't quietly disagree with what the business actually
 * billed.
 */
export default function StatsPage() {
  const [range, setRange] = useState({ from: monthsAgo(6), to: today(), granularity: 'month' });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [locationView, setLocationView] = useState('state');

  const load = useCallback(() => {
    fetchStats(range).then(setData).catch((e) => { setError(e.message); setData(null); });
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const applyPreset = (p) => {
    setRange((r) => ({
      ...r,
      from: p.calendarYear ? startOfYear() : monthsAgo(p.months),
      to: today(),
    }));
  };

  const download = async () => {
    setDownloading(true);
    setError('');
    try {
      await downloadStatsCsv(range);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <AppShell>
      <div style={styles.page}>
        <div style={styles.head}>
          <h1 style={styles.title}>Statistics</h1>
          <button onClick={download} disabled={downloading || !data} style={styles.downloadBtn}>
            {downloading ? 'Preparing…' : '⬇ Download CSV'}
          </button>
        </div>

        <div style={styles.filters}>
          <div style={styles.presets}>
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => applyPreset(p)} style={styles.presetBtn}>{p.label}</button>
            ))}
          </div>
          <div style={styles.dateRow}>
            <label style={styles.dateField}>
              <span style={styles.dateLabel}>From</span>
              <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} style={styles.dateInput} />
            </label>
            <label style={styles.dateField}>
              <span style={styles.dateLabel}>To</span>
              <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} style={styles.dateInput} />
            </label>
            <label style={styles.dateField}>
              <span style={styles.dateLabel}>Group by</span>
              <select
                value={range.granularity}
                onChange={(e) => setRange((r) => ({ ...r, granularity: e.target.value }))}
                style={styles.dateInput}
              >
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </label>
          </div>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        {!data ? (
          <p style={styles.loading}>Loading…</p>
        ) : (
          <>
            <SummaryCards summary={data.summary} />
            <TrendChart byPeriod={data.byPeriod} granularity={data.range.granularity} />

            <div className="gm-card" style={styles.card}>
              <div style={styles.locationHead}>
                <h3 style={styles.cardTitle}>By location</h3>
                <div style={styles.locationToggle}>
                  <button
                    onClick={() => setLocationView('state')}
                    style={{ ...styles.toggleBtn, ...(locationView === 'state' ? styles.toggleBtnActive : {}) }}
                  >
                    State
                  </button>
                  <button
                    onClick={() => setLocationView('postcode')}
                    style={{ ...styles.toggleBtn, ...(locationView === 'postcode' ? styles.toggleBtnActive : {}) }}
                  >
                    Postcode
                  </button>
                </div>
              </div>
              <LocationTable rows={locationView === 'state' ? data.byState : data.byPostcode} label={locationView === 'state' ? 'State' : 'Postcode'} />
            </div>

            <div className="gm-card" style={styles.card}>
              <h3 style={styles.cardTitle}>By vet</h3>
              <VetTable rows={data.byVet} />
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function SummaryCards({ summary }) {
  const cards = [
    { label: 'Total jobs', value: summary.totalJobs },
    { label: 'Completed', value: summary.completedJobs },
    { label: 'Cancelled', value: summary.cancelledJobs },
    { label: 'Revenue', value: money(summary.revenue) },
    { label: 'Net revenue', value: money(summary.netRevenue), hint: 'after refunds, plus cancellation fees' },
    { label: 'Average job value', value: money(summary.averageJobValue) },
  ];
  return (
    <div style={styles.summaryGrid}>
      {cards.map((c) => (
        <div key={c.label} className="gm-card" style={styles.summaryCard}>
          <div style={styles.summaryValue}>{c.value}</div>
          <div style={styles.summaryLabel}>{c.label}</div>
          {c.hint && <div style={styles.summaryHint}>{c.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/** Simple CSS bar chart — no charting dependency needed for this. */
function TrendChart({ byPeriod, granularity }) {
  if (byPeriod.length === 0) {
    return (
      <div className="gm-card" style={styles.card}>
        <p style={styles.empty}>No jobs in this range.</p>
      </div>
    );
  }
  const maxRevenue = Math.max(...byPeriod.map((p) => p.revenue), 1);

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>
        Revenue by {granularity}
      </h3>
      <div style={styles.chart}>
        {byPeriod.map((p) => (
          <div key={p.period} style={styles.chartCol}>
            <div style={styles.chartBarTrack}>
              <div
                style={{ ...styles.chartBar, height: `${Math.max(2, (p.revenue / maxRevenue) * 100)}%` }}
                title={`${p.period}: ${money(p.revenue)} · ${p.completed} completed`}
              />
            </div>
            <div style={styles.chartValue}>{p.revenue > 0 ? money(p.revenue) : '—'}</div>
            <div style={styles.chartLabel}>{p.period}</div>
            <div style={styles.chartCount}>
              {p.completed}✓{p.cancelled > 0 ? ` · ${p.cancelled}✕` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LocationTable({ rows, label }) {
  if (rows.length === 0) return <p style={styles.empty}>No jobs in this range.</p>;
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>{label}</th>
          <th style={styles.th}>Jobs</th>
          <th style={styles.th}>Completed</th>
          <th style={styles.thRight}>Revenue</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.location}>
            <td style={styles.td}>{r.location}</td>
            <td style={styles.td}>{r.totalJobs}</td>
            <td style={styles.td}>{r.completedJobs}</td>
            <td style={styles.tdRight}>{money(r.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VetTable({ rows }) {
  if (rows.length === 0) return <p style={styles.empty}>No jobs assigned to a vet in this range.</p>;
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Vet</th>
          <th style={styles.th}>Jobs</th>
          <th style={styles.th}>Completed</th>
          <th style={styles.thRight}>Revenue generated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.vetId}>
            <td style={styles.td}>{r.vetName}</td>
            <td style={styles.td}>{r.totalJobs}</td>
            <td style={styles.td}>{r.completedJobs}</td>
            <td style={styles.tdRight}>{money(r.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const styles = {
  page: { padding: '24px 28px', maxWidth: 960 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24 },
  downloadBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '9px 18px', fontSize: 13, fontWeight: 500 },
  filters: { marginBottom: 20 },
  presets: { display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  presetBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '7px 14px', fontSize: 12.5 },
  dateRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  dateField: { display: 'flex', flexDirection: 'column', gap: 3 },
  dateLabel: { fontSize: 11, color: 'var(--gm-ink-soft)' },
  dateInput: { padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 13, fontFamily: 'inherit', background: '#fff' },
  error: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 14 },
  loading: { fontSize: 13, color: 'var(--gm-ink-soft)' },
  empty: { fontSize: 13, color: 'var(--gm-ink-soft)' },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 },
  summaryCard: { padding: '14px 16px' },
  summaryValue: { fontFamily: 'var(--gm-font-display)', fontSize: 22, fontWeight: 600, color: 'var(--gm-forest-dark)' },
  summaryLabel: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  summaryHint: { fontSize: 10, color: 'var(--gm-ink-soft)', marginTop: 2 },
  card: { padding: 18, marginBottom: 16 },
  cardTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 16, fontWeight: 600, marginBottom: 14 },
  locationHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 },
  locationToggle: { display: 'flex', gap: 4, marginBottom: 14 },
  toggleBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '5px 12px', fontSize: 12 },
  toggleBtnActive: { background: 'var(--gm-forest)', color: '#fff', borderColor: 'var(--gm-forest)' },
  chart: { display: 'flex', alignItems: 'flex-end', gap: 10, height: 180, overflowX: 'auto', paddingBottom: 4 },
  chartCol: { display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 54, height: '100%' },
  chartBarTrack: { flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' },
  chartBar: { width: '100%', background: 'var(--gm-forest)', borderRadius: '4px 4px 0 0', minHeight: 2 },
  chartValue: { fontSize: 10, color: 'var(--gm-ink-soft)', marginTop: 4, whiteSpace: 'nowrap' },
  chartLabel: { fontSize: 11, fontWeight: 500, marginTop: 2 },
  chartCount: { fontSize: 9, color: 'var(--gm-ink-soft)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', fontSize: 11, color: 'var(--gm-ink-soft)', fontWeight: 500, padding: '6px 8px', borderBottom: '1px solid var(--gm-line)' },
  thRight: { textAlign: 'right', fontSize: 11, color: 'var(--gm-ink-soft)', fontWeight: 500, padding: '6px 8px', borderBottom: '1px solid var(--gm-line)' },
  td: { padding: '8px 8px', borderBottom: '1px solid var(--gm-line-soft)' },
  tdRight: { padding: '8px 8px', borderBottom: '1px solid var(--gm-line-soft)', textAlign: 'right', fontWeight: 500 },
};
