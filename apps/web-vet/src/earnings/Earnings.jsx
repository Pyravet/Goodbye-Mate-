import { useEffect, useState } from 'react';
import AppShell from '../layout/AppShell.jsx';
import { fetchMe, fetchEarnings, fetchMyPayoutPeriods, openMyPeriodRcti } from '../vets/vetsApi.js';
import { apiFetch } from '../api.js';
import { formatMoney } from '@goodbye-mate/web-shared/src/format.js';

function formatWeekLabel(weekStart) {
  const d = new Date(weekStart + 'T00:00:00');
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  return `${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`;
}

// PDF downloads need the auth header, so fetch as a blob and trigger the
// browser's save dialog rather than a plain <a href>.
async function downloadRcti(jobId, jobNumber) {
  const res = await apiFetch(`/jobs/${jobId}/rcti.pdf`);
  if (!res.ok) throw new Error('Failed to generate RCTI');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `RCTI-${jobNumber}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Earnings() {
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedWeek, setExpandedWeek] = useState(null);
  const [downloadError, setDownloadError] = useState('');

  const [periods, setPeriods] = useState([]);

  useEffect(() => {
    fetchMe()
      .then((meData) => fetchEarnings(meData.vet.id))
      .then(setEarnings)
      .catch(() => setError('Could not load earnings.'))
      .finally(() => setLoading(false));
    // Payout periods load independently — a failure here shouldn't hide
    // the earnings summary above it.
    fetchMyPayoutPeriods().then(setPeriods).catch(() => setPeriods([]));
  }, []);

  const onOpenRcti = async (periodId) => {
    setDownloadError('');
    try {
      await openMyPeriodRcti(periodId);
    } catch (err) {
      setDownloadError(err.message);
    }
  };

  const onDownloadRcti = async (jobId, jobNumber) => {
    setDownloadError('');
    try {
      await downloadRcti(jobId, jobNumber);
    } catch {
      setDownloadError('Could not generate that RCTI — try again.');
    }
  };

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Earnings</h1>

        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : error ? (
          <p style={styles.errorNote}>{error}</p>
        ) : (
          <>
            <div style={styles.summaryGrid}>
              <SummaryStat label="Today" value={earnings.today} />
              <SummaryStat label="This week" value={earnings.thisWeek} />
              <SummaryStat label="This month" value={earnings.thisMonth} />
              <SummaryStat label="All-time" value={earnings.allTime} />
            </div>

            {earnings.upcoming > 0 && (
              <p style={styles.upcomingNote}>
                Plus {formatMoney(earnings.upcoming)} for jobs booked but not yet completed.
              </p>
            )}

            <h3 style={styles.sectionTitle}>Weekly payouts</h3>
            {periods.length === 0 ? (
              <p style={styles.empty}>No payouts issued yet. Once admin approves a week, its RCTI appears here.</p>
            ) : (
              periods.map((p) => (
                <div key={p.id} className="gm-card" style={styles.weekCard}>
                  <div style={styles.payoutRow}>
                    <div>
                      <div style={styles.payoutWeek}>{formatWeekLabel(String(p.period_start).slice(0, 10))}</div>
                      <div style={styles.payoutMeta}>
                        {p.rcti_number}
                        {p.status === 'paid' && p.paid_at
                          ? ` · paid ${new Date(p.paid_at).toLocaleDateString('en-AU')}`
                          : ' · awaiting payment'}
                      </div>
                    </div>
                    <div style={styles.payoutRight}>
                      <div style={styles.payoutTotal}>{formatMoney(Number(p.total))}</div>
                      <span className={`gm-badge ${p.status === 'paid' ? 'gm-badge--forest' : 'gm-badge--honey'}`}>
                        {p.status}
                      </span>
                    </div>
                  </div>
                  {Number(p.gst) > 0 && (
                    <div style={styles.payoutGst}>
                      Subtotal {formatMoney(Number(p.subtotal))} · GST {formatMoney(Number(p.gst))}
                    </div>
                  )}
                  <button onClick={() => onOpenRcti(p.id)} style={styles.rctiWideBtn}>View RCTI</button>
                </div>
              ))
            )}

            <h3 style={styles.sectionTitle}>Job history</h3>
            {downloadError && <p style={styles.errorNote}>{downloadError}</p>}

            {earnings.weeklyHistory.length === 0 ? (
              <p style={styles.empty}>No completed jobs yet.</p>
            ) : (
              earnings.weeklyHistory.map((week) => (
                <div key={week.weekStart} className="gm-card" style={styles.weekCard}>
                  <button
                    onClick={() => setExpandedWeek(expandedWeek === week.weekStart ? null : week.weekStart)}
                    style={styles.weekHeader}
                  >
                    <span style={styles.weekLabel}>{formatWeekLabel(week.weekStart)}</span>
                    <span style={styles.weekMeta}>{week.jobCount} job{week.jobCount === 1 ? '' : 's'} · {formatMoney(week.total)}</span>
                  </button>
                  {expandedWeek === week.weekStart && (
                    <div style={styles.weekJobs}>
                      {week.jobs.map((j) => (
                        <div key={j.id} style={styles.weekJobRow}>
                          <div>
                            <div style={styles.jobPetName}>{j.petName}</div>
                            <div style={styles.jobMeta}>{j.jobNumber} · {new Date(j.jobDate + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</div>
                          </div>
                          <div style={styles.jobRight}>
                            <span style={styles.jobPayout}>{formatMoney(j.payout)}</span>
                            <button onClick={() => onDownloadRcti(j.id, j.jobNumber)} style={styles.rctiBtn}>RCTI</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function SummaryStat({ label, value }) {
  return (
    <div style={styles.statCard} className="gm-card">
      <div style={styles.statValue}>{formatMoney(value)}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

const styles = {
  page: { padding: '20px 16px' },
  title: { fontSize: 22, marginBottom: 16 },
  empty: { color: 'var(--gm-ink-soft)', fontSize: 13 },
  errorNote: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 10 },
  summaryGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 6 },
  statCard: { padding: '14px 16px' },
  statValue: { fontFamily: 'var(--gm-font-display)', fontSize: 20, fontWeight: 600, color: 'var(--gm-forest-dark)' },
  statLabel: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  upcomingNote: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 10, fontStyle: 'italic' },
  sectionTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginTop: 22, marginBottom: 10, fontWeight: 600 },
  payoutRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, padding: '14px 16px 6px' },
  payoutWeek: { fontFamily: 'var(--gm-font-display)', fontSize: 15, fontWeight: 600 },
  payoutMeta: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 2 },
  payoutRight: { textAlign: 'right', flexShrink: 0 },
  payoutTotal: { fontFamily: 'var(--gm-font-display)', fontSize: 17, fontWeight: 600, marginBottom: 3 },
  payoutGst: { fontSize: 11, color: 'var(--gm-ink-soft)', padding: '0 16px 6px' },
  rctiWideBtn: { width: 'calc(100% - 32px)', margin: '0 16px 14px', background: '#fff', color: 'var(--gm-forest)', border: '1px solid var(--gm-forest)', borderRadius: 'var(--gm-radius-sm)', padding: '8px 0', fontSize: 12, fontWeight: 500 },
  weekCard: { marginBottom: 8, overflow: 'hidden' },
  weekHeader: { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: 'none', border: 'none', textAlign: 'left' },
  weekLabel: { fontSize: 14, fontWeight: 600, color: 'var(--gm-ink)' },
  weekMeta: { fontSize: 13, color: 'var(--gm-ink-soft)' },
  weekJobs: { borderTop: '1px solid var(--gm-line)', padding: '4px 16px 10px' },
  weekJobRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--gm-line-soft)' },
  jobPetName: { fontSize: 14, fontWeight: 500 },
  jobMeta: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  jobRight: { display: 'flex', alignItems: 'center', gap: 8 },
  jobPayout: { fontSize: 14, fontWeight: 600, color: 'var(--gm-forest-dark)' },
  rctiBtn: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '5px 10px', fontSize: 11, fontWeight: 500 },
};
