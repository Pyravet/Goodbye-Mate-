import { useEffect, useState, useCallback } from 'react';
import AppShell from '../layout/AppShell.jsx';
import { formatMoney } from '@goodbye-mate/web-shared/src/format.js';
import { fetchPayoutRun, approvePeriod, markPeriodPaid, openPeriodRcti } from './payoutsApi.js';

/** Shift a YYYY-MM-DD string by whole weeks, in UTC to avoid TZ drift. */
function shiftWeeks(dateStr, weeks) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function formatDay(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

export default function PayoutsPage() {
  const [anchor, setAnchor] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyVet, setBusyVet] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetchPayoutRun(anchor)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [anchor]);

  useEffect(() => { load(); }, [load]);

  const onApprove = async (vetId) => {
    setBusyVet(vetId);
    setError('');
    try {
      await approvePeriod(vetId, data.periodStart);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyVet(null);
    }
  };

  const onMarkPaid = async (vetId, periodId) => {
    const reference = window.prompt('Payment reference (optional) — e.g. bank transfer ID');
    // prompt returns null if cancelled; '' means they confirmed with no reference.
    if (reference === null) return;
    setBusyVet(vetId);
    setError('');
    try {
      await markPeriodPaid(periodId, reference.trim());
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyVet(null);
    }
  };

  const onOpenRcti = async (periodId) => {
    setError('');
    try {
      await openPeriodRcti(periodId);
    } catch (err) {
      setError(err.message);
    }
  };

  const weekTotal = (data?.vets || []).reduce((sum, v) => sum + Number(v.total || 0), 0);

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Vet payouts</h1>

        <div style={styles.weekNav}>
          <button onClick={() => setAnchor(shiftWeeks(anchor, -1))} style={styles.navBtn}>← Previous</button>
          <div style={styles.weekLabel}>
            {data ? `${formatDay(data.periodStart)} – ${formatDay(data.periodEnd)}` : '…'}
          </div>
          <button onClick={() => setAnchor(shiftWeeks(anchor, 1))} style={styles.navBtn}>Next →</button>
        </div>
        <button onClick={() => setAnchor(new Date().toISOString().slice(0, 10))} style={styles.thisWeekBtn}>
          This week
        </button>

        {error && <p style={styles.error}>{error}</p>}

        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : !data || data.vets.length === 0 ? (
          <p style={styles.empty}>No completed jobs in this week yet — nothing to pay.</p>
        ) : (
          <>
            <p style={styles.weekSummary}>
              {data.vets.length} vet{data.vets.length === 1 ? '' : 's'} · {formatMoney(weekTotal)} total
            </p>

            {data.vets.map((v) => {
              const p = v.period;
              const status = p?.status || 'draft';
              const busy = busyVet === v.vetId;
              return (
                <div key={v.vetId} className="gm-card" style={styles.vetCard}>
                  <div style={styles.vetHeader}>
                    <div>
                      <div style={styles.vetName}>{v.vetName}</div>
                      <div style={styles.vetMeta}>
                        {v.jobs.length} job{v.jobs.length === 1 ? '' : 's'}
                        {!v.isGstRegistered && ' · not GST registered'}
                        {p?.rctiNumber && ` · ${p.rctiNumber}`}
                      </div>
                    </div>
                    <div style={styles.vetRight}>
                      <div style={styles.vetTotal}>{formatMoney(v.total)}</div>
                      <span className={`gm-badge ${
                        status === 'paid' ? 'gm-badge--forest'
                          : status === 'approved' ? 'gm-badge--honey'
                            : 'gm-badge--brick'
                      }`}>
                        {status === 'draft' ? 'Not approved' : status}
                      </span>
                    </div>
                  </div>

                  <div style={styles.jobList}>
                    {v.jobs.map((j) => (
                      <div key={j.id} style={styles.jobRow}>
                        <span style={styles.jobDate}>{formatDay(String(j.jobDate).slice(0, 10))}</span>
                        <span style={styles.jobName}>{j.petName} · {j.jobNumber}</span>
                        <span style={styles.jobAmt}>{formatMoney(j.amount)}</span>
                      </div>
                    ))}
                  </div>

                  {p && (
                    <div style={styles.breakdown}>
                      <span>Subtotal {formatMoney(p.subtotal)}</span>
                      <span>GST {formatMoney(p.gst)}</span>
                      <strong>Total {formatMoney(p.total)}</strong>
                    </div>
                  )}
                  {p?.paidAt && (
                    <p style={styles.paidNote}>
                      Paid {new Date(p.paidAt).toLocaleDateString('en-AU')}
                      {p.paymentReference ? ` · ref ${p.paymentReference}` : ''}
                    </p>
                  )}

                  <div style={styles.actions}>
                    {status === 'draft' && (
                      <button onClick={() => onApprove(v.vetId)} disabled={busy} style={styles.primaryBtn}>
                        {busy ? 'Approving…' : 'Approve & issue RCTI'}
                      </button>
                    )}
                    {status !== 'draft' && (
                      <button onClick={() => onOpenRcti(p.id)} style={styles.secondaryBtn}>
                        View RCTI
                      </button>
                    )}
                    {status === 'approved' && (
                      <button onClick={() => onMarkPaid(v.vetId, p.id)} disabled={busy} style={styles.primaryBtn}>
                        {busy ? 'Saving…' : 'Mark paid'}
                      </button>
                    )}
                  </div>

                  {status === 'draft' && (
                    <p style={styles.draftHint}>
                      Approving freezes these amounts and issues a numbered RCTI. Later changes to
                      pricing or job charges won't alter it.
                    </p>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </AppShell>
  );
}

const styles = {
  page: { padding: '24px 28px', maxWidth: 860 },
  title: { fontSize: 24, marginBottom: 16 },
  weekNav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  navBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '7px 14px', fontSize: 13 },
  weekLabel: { fontFamily: 'var(--gm-font-display)', fontSize: 16, fontWeight: 600 },
  thisWeekBtn: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '5px 12px', fontSize: 12, marginBottom: 16 },
  weekSummary: { fontSize: 13, color: 'var(--gm-ink-soft)', marginBottom: 12 },
  empty: { color: 'var(--gm-ink-soft)', fontSize: 13 },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 12 },
  vetCard: { padding: 16, marginBottom: 14 },
  vetHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  vetName: { fontFamily: 'var(--gm-font-display)', fontSize: 17, fontWeight: 600 },
  vetMeta: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  vetRight: { textAlign: 'right', flexShrink: 0 },
  vetTotal: { fontFamily: 'var(--gm-font-display)', fontSize: 18, fontWeight: 600, marginBottom: 4 },
  jobList: { borderTop: '1px solid var(--gm-line-soft)', paddingTop: 8, marginBottom: 10 },
  jobRow: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '4px 0' },
  jobDate: { width: 60, color: 'var(--gm-ink-soft)', flexShrink: 0 },
  jobName: { flex: 1, minWidth: 0 },
  jobAmt: { fontWeight: 500, flexShrink: 0 },
  breakdown: { display: 'flex', gap: 16, fontSize: 12, color: 'var(--gm-ink-soft)', paddingTop: 8, borderTop: '1px solid var(--gm-line-soft)' },
  paidNote: { fontSize: 12, color: 'var(--gm-forest)', marginTop: 6 },
  actions: { display: 'flex', gap: 8, marginTop: 12 },
  primaryBtn: { flex: 1, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '9px 0', fontSize: 13, fontWeight: 500 },
  secondaryBtn: { flex: 1, background: '#fff', color: 'var(--gm-forest)', border: '1px solid var(--gm-forest)', borderRadius: 'var(--gm-radius-sm)', padding: '9px 0', fontSize: 13, fontWeight: 500 },
  draftHint: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 8, fontStyle: 'italic' },
};
