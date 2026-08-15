import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import AppShell from '../layout/AppShell.jsx';
import { apiFetch } from '../api.js';
import { fetchJob, completeJob, downloadInvoice, downloadQuote, downloadRcti, emailDocument } from './jobsApi.js';
import TakePayment from './TakePayment.jsx';

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [completeError, setCompleteError] = useState(null);
  const [downloadError, setDownloadError] = useState('');
  const [emailStatus, setEmailStatus] = useState({}); // { quote: 'sending'|'sent'|'error', ... }
  const [showPayment, setShowPayment] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchJob(id).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (path, options) => {
    setBusy(true);
    try {
      await apiFetch(path, options);
      load();
    } finally {
      setBusy(false);
    }
  };

  const onComplete = async () => {
    setCompleteError(null);
    setBusy(true);
    try {
      await completeJob(id);
      load();
    } catch (err) {
      setCompleteError(err.missing || [err.message]);
    } finally {
      setBusy(false);
    }
  };

  const onDownloadInvoice = async () => {
    setDownloadError('');
    try {
      await downloadInvoice(id, data.job.job_number);
    } catch {
      setDownloadError('Could not generate the invoice — try again.');
    }
  };

  const onDownloadQuote = async () => {
    setDownloadError('');
    try {
      await downloadQuote(id, data.job.job_number);
    } catch {
      setDownloadError('Could not generate the quote — try again.');
    }
  };

  const onDownloadRcti = async () => {
    setDownloadError('');
    try {
      await downloadRcti(id, data.job.job_number);
    } catch {
      setDownloadError('Could not generate the RCTI — try again.');
    }
  };

  const onEmail = async (type) => {
    setEmailStatus((s) => ({ ...s, [type]: 'sending' }));
    try {
      await emailDocument(id, type);
      setEmailStatus((s) => ({ ...s, [type]: 'sent' }));
    } catch (err) {
      setEmailStatus((s) => ({ ...s, [type]: err.message }));
    }
  };

  if (loading) return <AppShell><div style={styles.page}>Loading…</div></AppShell>;
  if (!data) return <AppShell><div style={styles.page}>Job not found.</div></AppShell>;

  const { job, bill } = data;
  const isCommunalOrPrivate = job.service_type !== 'euthanasia_only';

  return (
    <AppShell>
      <div style={styles.page}>
        <Link to="/" style={styles.back}>← All jobs</Link>

        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>{job.pet_name}</h1>
            <p style={styles.subtitle}>{job.job_number} · {job.client_name} · {new Date(job.job_date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })} at {job.job_time}</p>
          </div>
          {job.pet_behaviour && job.pet_behaviour !== 'Friendly' && (
            <span className="gm-badge gm-badge--honey">{job.pet_behaviour}</span>
          )}
        </div>

        <div style={styles.grid}>
          <div>
            <Card title="Task checklist">
              <TaskRow label="Vet assigned" done={!!job.assigned_vet_id} />
              <TaskRow label="Consent signed" done={job.consent_signed}
                action={!job.consent_signed && <ActionBtn onClick={() => doAction(`/jobs/${id}/consent-signed`, { method: 'POST' })} busy={busy}>Mark signed</ActionBtn>} />
              <TaskRow label="Payment received" done={job.payment_status === 'paid'}
                action={job.payment_status !== 'paid' && <ActionBtn onClick={() => doAction(`/jobs/${id}/payment-received`, { method: 'POST' })} busy={busy}>Mark paid</ActionBtn>} />
              <TaskRow label="Procedure performed" done={job.procedure_done}
                action={!job.procedure_done && <ActionBtn onClick={() => doAction(`/jobs/${id}/procedure-done`, { method: 'POST' })} busy={busy}>Mark done</ActionBtn>} />
              {isCommunalOrPrivate && (
                <TaskRow label="Cremation booked with partner" done={job.cremation_booked}
                  action={!job.cremation_booked && <ActionBtn onClick={() => doAction(`/jobs/${id}/cremation-booked`, { method: 'POST', body: JSON.stringify({}) })} busy={busy}>Mark booked</ActionBtn>} />
              )}

              {job.status !== 'completed' && job.status !== 'cancelled' && (
                <div style={styles.completeRow}>
                  <button onClick={onComplete} disabled={busy} style={styles.completeBtn}>Mark job complete</button>
                  {completeError && (
                    <p style={styles.completeError}>Still needed: {completeError.join(', ')}</p>
                  )}
                </div>
              )}
              {job.status === 'completed' && <p style={styles.completedNote}>This job is complete.</p>}
            </Card>

            <Card title="Address">
              <p style={styles.plain}>{job.address}</p>
              {job.notes && <p style={styles.notes}>{job.notes}</p>}
            </Card>
          </div>

          <div>
            <Card title="Dispatch">
              <p style={styles.plain}>
                {job.dispatch_state === 'offered' && 'Offer sent, awaiting vet response.'}
                {job.dispatch_state === 'accepted' && 'Vet confirmed.'}
                {job.dispatch_state === 'unassigned' && 'No vet available — needs manual assignment.'}
                {job.dispatch_state === 'none' && 'Not yet dispatched.'}
              </p>
            </Card>

            <Card title="Billing">
              {bill.lines.map((l, i) => (
                <div key={i} style={styles.billLine}>
                  <span>{l.label}</span><span>${l.amount.toFixed(2)}</span>
                </div>
              ))}
              <div style={{ ...styles.billLine, ...styles.billTotal }}>
                <span>Total</span><span>${bill.total.toFixed(2)}</span>
              </div>

              {job.payment_status === 'paid' ? (
                <p style={styles.paidNote}>
                  Paid{job.payment_reference ? ` — ref ${job.payment_reference}` : ''}.
                </p>
              ) : paymentSuccess ? (
                <p style={styles.paidNote}>Payment received — ref {paymentSuccess.transactionId}.</p>
              ) : showPayment ? (
                <TakePayment
                  jobId={id}
                  amount={bill.total}
                  onSuccess={(result) => { setPaymentSuccess(result); setShowPayment(false); load(); }}
                />
              ) : (
                <button onClick={() => setShowPayment(true)} style={styles.takePaymentBtn}>Take payment</button>
              )}
            </Card>

            <Card title="Documents">
              {downloadError && <p style={styles.completeError}>{downloadError}</p>}
              <div style={styles.docRow}>
                <DocRow label="Quote" onDownload={onDownloadQuote} onEmail={() => onEmail('quote')} status={emailStatus.quote} disabled={!job.client_email} />
                <DocRow
                  label={job.payment_status === 'paid' ? 'Receipt' : 'Invoice'}
                  onDownload={onDownloadInvoice}
                  onEmail={() => onEmail('invoice')}
                  status={emailStatus.invoice}
                  disabled={!job.client_email}
                />
                {job.assigned_vet_id ? (
                  <DocRow label="RCTI" onDownload={onDownloadRcti} onEmail={() => onEmail('rcti')} status={emailStatus.rcti} />
                ) : (
                  <p style={styles.docHint}>RCTI available once a vet is assigned.</p>
                )}
                {!job.client_email && <p style={styles.docHint}>Add a client email to enable emailing quotes/invoices.</p>}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Card({ title, children }) {
  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>{title}</h3>
      {children}
    </div>
  );
}
function TaskRow({ label, done, action }) {
  return (
    <div style={styles.taskRow}>
      <span style={{ ...styles.taskDot, background: done ? 'var(--gm-forest)' : 'var(--gm-line)' }} />
      <span style={{ flex: 1, color: done ? 'var(--gm-ink)' : 'var(--gm-ink-soft)' }}>{label}</span>
      {action}
    </div>
  );
}
function ActionBtn({ onClick, busy, children }) {
  return <button onClick={onClick} disabled={busy} style={styles.actionBtn}>{children}</button>;
}
function DocRow({ label, onDownload, onEmail, status, disabled }) {
  return (
    <div style={styles.docItemRow}>
      <span style={styles.docLabel}>{label}</span>
      <button onClick={onDownload} style={styles.docBtn}>Download</button>
      <button onClick={onEmail} disabled={disabled || status === 'sending'} style={styles.docBtn}>
        {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Sent ✓' : 'Email'}
      </button>
      {status && status !== 'sending' && status !== 'sent' && <span style={styles.docError}>{status}</span>}
    </div>
  );
}

const styles = {
  page: { padding: '32px 40px', maxWidth: 900 },
  back: { fontSize: 13, color: 'var(--gm-ink-soft)', textDecoration: 'none' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '12px 0 24px' },
  title: { fontSize: 28 },
  subtitle: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 4 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' },
  card: { padding: 18, marginBottom: 16 },
  cardTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginBottom: 12, fontFamily: 'var(--gm-font-body)', fontWeight: 600 },
  taskRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', fontSize: 14 },
  taskDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  actionBtn: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 6, padding: '4px 10px', fontSize: 12 },
  completeRow: { marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--gm-line)' },
  completeBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500 },
  completeError: { fontSize: 12, color: 'var(--gm-brick)', marginTop: 8 },
  completedNote: { fontSize: 13, color: 'var(--gm-forest-dark)', marginTop: 12 },
  plain: { fontSize: 14, margin: 0 },
  notes: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 8, fontStyle: 'italic' },
  billLine: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' },
  billTotal: { borderTop: '1px solid var(--gm-line)', marginTop: 6, paddingTop: 8, fontWeight: 600 },
  paidNote: { fontSize: 13, color: 'var(--gm-forest-dark)', marginTop: 12, fontWeight: 500 },
  takePaymentBtn: { width: '100%', background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '10px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500, marginTop: 14 },
  docRow: { display: 'flex', flexDirection: 'column', gap: 8 },
  docItemRow: { display: 'flex', alignItems: 'center', gap: 8 },
  docLabel: { fontSize: 13, fontWeight: 500, flex: 1 },
  docBtn: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '7px 12px', fontSize: 12, fontWeight: 500 },
  docError: { fontSize: 11, color: 'var(--gm-brick)' },
  docHint: { fontSize: 12, color: 'var(--gm-ink-soft)', fontStyle: 'italic', margin: 0 },
};
