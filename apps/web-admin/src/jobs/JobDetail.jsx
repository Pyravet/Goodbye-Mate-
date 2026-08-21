import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import { apiFetch } from '../api.js';
import { fetchJob, completeJob, downloadInvoice, downloadQuote, downloadRcti, emailDocument, sendQuoteEverywhere, sendJourneyLink, assignVet, fetchDispatchDebug, redispatchJob, openConsentPdf, saveAdminNotes, cancelJob, reinstateJob, refundJob } from './jobsApi.js';
import JobCharges from './JobCharges.jsx';
import OfferControl from './OfferControl.jsx';
import EditJobForm from './EditJobForm.jsx';
import VetRecordCard from '@goodbye-mate/web-shared/src/VetRecordCard.jsx';
import { openVetRecord, emailVetRecord } from './jobsApi.js';
import { fetchVets } from '../vets/vetsApi.js';
import TakePayment from './TakePayment.jsx';
import MessageThread from './MessageThread.jsx';
import { useAuth } from '../AuthContext.jsx';

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [completeError, setCompleteError] = useState(null);
  const [downloadError, setDownloadError] = useState('');
  const [emailStatus, setEmailStatus] = useState({}); // { quote: 'sending'|'sent'|'error', ... }
  const [sendQuoteStatus, setSendQuoteStatus] = useState('idle'); // idle | sending | done
  const [sendQuoteResult, setSendQuoteResult] = useState(null); // { email, sms }
  const [showPayment, setShowPayment] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(null);
  const [journeyStatus, setJourneyStatus] = useState('idle'); // idle | sending | done
  const [journeyResult, setJourneyResult] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchJob(id).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState(false);

  /**
   * Run a checklist action and reload the job.
   *
   * apiFetch RESOLVES on a failed HTTP status rather than throwing, so
   * the previous version silently swallowed every 4xx/5xx: the page just
   * reloaded unchanged and the user had no idea the click had failed.
   * That is exactly how the "Mark done" 403 stayed invisible. Now a
   * failure surfaces the server's message.
   */
  const doAction = async (path, options) => {
    setBusy(true);
    setActionError('');
    try {
      const res = await apiFetch(path, options);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error || `That didn't work (HTTP ${res.status}).`);
        return;
      }
      load();
    } catch (err) {
      setActionError(err.message || 'Something went wrong.');
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

  const onSendQuoteEverywhere = async () => {
    setSendQuoteStatus('sending');
    setSendQuoteResult(null);
    const result = await sendQuoteEverywhere(id, {
      hasEmail: !!data.job.client_email,
      hasPhone: !!data.job.client_phone,
    });
    setSendQuoteResult(result);
    setSendQuoteStatus('done');
  };

  const onSendJourneyLink = async () => {
    setJourneyStatus('sending');
    try {
      const result = await sendJourneyLink(id);
      setJourneyResult(result);
    } catch (err) {
      setJourneyResult({ error: err.message });
    } finally {
      setJourneyStatus('done');
    }
  };

  const onCopyLink = async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* clipboard access denied — silently ignore, the link is visible to copy manually */
    }
  };

  if (loading) return <AppShell><div style={styles.page}>Loading…</div></AppShell>;
  if (!data) return <AppShell><div style={styles.page}>Job not found.</div></AppShell>;

  const { job, bill } = data;
  const clientAppBase = import.meta.env.VITE_CLIENT_APP_URL || 'https://care.goodbyemate.com.au';
  const journeyLink = `${clientAppBase.replace(/\/$/, '')}/${job.client_token}`;
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
              {actionError && <p style={styles.assignError}>{actionError}</p>}
              <TaskRow label="Vet assigned" done={!!job.assigned_vet_id} />
              {job.consent_signed && (
                <button
                  onClick={() => openConsentPdf(id, job.job_number).catch((e) => setActionError(e.message))}
                  style={styles.consentBtn}
                >
                  Download signed consent
                </button>
              )}
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

              {/* Private cremation only — communal cremation returns no
                  ashes, so showing this there would imply a step that
                  never happens. Not a completion gate: ashes come back
                  from the crematorium days after the visit, so the job
                  closes first and this is tracked afterwards. */}
              {job.service_type === 'private_cremation' && (
                <TaskRow label="Ashes returned to client" done={job.ashes_returned}
                  action={!job.ashes_returned && <ActionBtn onClick={() => doAction(`/jobs/${id}/ashes-returned`, { method: 'POST' })} busy={busy}>Mark returned</ActionBtn>} />
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

            {/* The client's contact details were never shown anywhere on
                this page — only their name, in the subtitle. Admin had no
                way to see the phone number or email while looking at a
                job, which is the single most-needed thing when handling
                one. Phone and email are click-to-call / click-to-mail. */}
            <Card title={editing ? 'Edit booking' : 'Client'}>
              {editing ? (
                <EditJobForm
                  job={job}
                  onCancel={() => setEditing(false)}
                  onSaved={() => { setEditing(false); load(); }}
                />
              ) : (
                <>
              <p style={styles.clientName}>{job.client_name}</p>
              {job.client_phone ? (
                <a href={`tel:${job.client_phone}`} style={styles.contactLink}>{job.client_phone}</a>
              ) : (
                <p style={styles.docHint}>No phone number on file.</p>
              )}
              {job.client_email ? (
                <a href={`mailto:${job.client_email}`} style={styles.contactLink}>{job.client_email}</a>
              ) : (
                <p style={styles.docHint}>
                  No email on file — quotes, invoices and the client journey link can&apos;t be
                  emailed without one.
                </p>
              )}
              {job.status !== 'completed' && (
                <button onClick={() => setEditing(true)} style={styles.editBtn}>Edit booking</button>
              )}
                </>
              )}
            </Card>

            <Card title="Address">
              <p style={styles.plain}>{job.address}</p>
              {(job.suburb || job.postcode) && (
                <p style={styles.plain}>
                  {[job.suburb, job.state, job.postcode].filter(Boolean).join(' ')}
                </p>
              )}
              {job.notes && <p style={styles.notes}>{job.notes}</p>}
            </Card>
          </div>

          <div>
            <Card title="Dispatch">
              <p style={styles.plain}>
                {job.dispatch_state === 'offered' && 'Offer sent, awaiting vet response.'}
                {job.dispatch_state === 'accepted' && 'Vet confirmed.'}
                {job.dispatch_state === 'unassigned' && 'No vet available — needs manual assignment.'}
                {job.dispatch_state === 'none' && 'Not yet dispatched — no vet has been offered this job.'}
              </p>
              {/* Always available while the job is live.
                  This was previously gated to dispatch_state 'none' or
                  'unassigned' with no assigned vet, which meant that in
                  every other state — including a stale offer, or a job
                  where dispatch silently never ran — there was simply NO
                  way to offer it to anyone. Hiding the only recovery
                  control precisely when it's needed is the wrong
                  default; the button now adapts its wording instead. */}
              {job.status !== 'completed' && job.status !== 'cancelled' && !job.assigned_vet_id && (
                <OfferControl job={job} onChanged={load} />
              )}

              {job.status !== 'completed' && job.status !== 'cancelled' && (
                <RedispatchButton
                  jobId={id}
                  dispatchState={job.dispatch_state}
                  hasVet={!!job.assigned_vet_id}
                  onDone={load}
                />
              )}
              {job.en_route_at && (
                <p style={styles.enRouteNote}>
                  🚗 Vet notified the client they're on the way at {new Date(job.en_route_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
                  {' '}— ETA was {job.en_route_eta_minutes} min ({job.en_route_distance_text}).
                </p>
              )}
              <AssignVetControl job={job} onAssigned={load} />
              <DispatchDebug jobId={id} />
            </Card>

            <Card title="Notes for the vet">
              <AdminNotesCard jobId={id} initial={job.admin_notes} />
            </Card>

            <Card title="Job status">
              <CancelCard job={job} onChanged={load} />
            </Card>

            {(job.payment_status === 'paid' || job.payment_status === 'refunded') && (
              <Card title="Refund">
                <RefundCard job={job} onChanged={load} />
              </Card>
            )}

            <Card title="Veterinary record">
              <VetRecordCard
                clientEmail={job.client_email}
                hasNotes={!!(job.medical_notes && job.medical_notes.trim())}
                onOpen={() => openVetRecord(id)}
                onEmail={(payload) => emailVetRecord(id, payload)}
              />
            </Card>

            <Card title="Client journey">
              <div style={styles.journeyStatusRow}>
                <StatusChip done={job.consent_signed} label="Consent" />
                <StatusChip done={job.payment_status === 'paid'} label="Payment" />
              </div>
              <div style={styles.journeyLinkRow}>
                <input readOnly value={journeyLink} style={styles.journeyLinkInput} onFocus={(e) => e.target.select()} />
                <button onClick={() => onCopyLink(journeyLink)} style={styles.journeyCopyBtn}>{linkCopied ? 'Copied' : 'Copy'}</button>
              </div>
              <button onClick={onSendJourneyLink} disabled={journeyStatus === 'sending'} style={styles.journeySendBtn}>
                {journeyStatus === 'sending' ? 'Sending…' : job.journey_link_sent_at ? 'Resend link (email + SMS)' : 'Send link (email + SMS)'}
              </button>
              {job.journey_link_sent_at && (
                <p style={styles.journeySentNote}>Last sent {new Date(job.journey_link_sent_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.</p>
              )}
              {journeyStatus === 'done' && journeyResult && (
                <div style={styles.sendEverywhereResult}>
                  {journeyResult.error && <span className="gm-badge gm-badge--brick">{journeyResult.error}</span>}
                  {journeyResult.email && (
                    <span className={`gm-badge ${journeyResult.email === 'sent' ? 'gm-badge--forest' : 'gm-badge--brick'}`}>Email: {journeyResult.email}</span>
                  )}
                  {journeyResult.sms && (
                    <span className={`gm-badge ${journeyResult.sms === 'sent' ? 'gm-badge--forest' : 'gm-badge--brick'}`}>SMS: {journeyResult.sms}</span>
                  )}
                </div>
              )}
            </Card>

            <Card title="Billing">
              {bill.lines.map((l, i) => (
                <div key={i} style={styles.billLine}>
                  <span>{l.label}</span><span>${l.amount.toFixed(2)}</span>
                </div>
              ))}
              <div style={styles.chargesBlock}>
                <JobCharges jobId={id} onChanged={load} />
              </div>
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

              {(job.client_email || job.client_phone) && (
                <div style={styles.sendEverywhereRow}>
                  <button
                    onClick={onSendQuoteEverywhere}
                    disabled={sendQuoteStatus === 'sending'}
                    style={styles.sendEverywhereBtn}
                  >
                    {sendQuoteStatus === 'sending' ? 'Sending…' : 'Send quote to client (email, SMS + WhatsApp)'}
                  </button>
                  {sendQuoteStatus === 'done' && sendQuoteResult && (
                    <div style={styles.sendEverywhereResult}>
                      {sendQuoteResult.email && (
                        <span className={`gm-badge ${sendQuoteResult.email === 'sent' ? 'gm-badge--forest' : 'gm-badge--brick'}`}>
                          Email: {sendQuoteResult.email === 'sent' ? 'sent' : sendQuoteResult.email}
                        </span>
                      )}
                      {sendQuoteResult.sms && (
                        <span className={`gm-badge ${sendQuoteResult.sms === 'sent' ? 'gm-badge--forest' : 'gm-badge--brick'}`}>
                          SMS: {sendQuoteResult.sms === 'sent' ? 'sent' : sendQuoteResult.sms}
                        </span>
                      )}
                      {sendQuoteResult.whatsapp && !/not configured/i.test(sendQuoteResult.whatsapp) && (
                        <span className={`gm-badge ${sendQuoteResult.whatsapp === 'sent' ? 'gm-badge--forest' : 'gm-badge--brick'}`}>
                          WhatsApp: {sendQuoteResult.whatsapp === 'sent' ? 'sent' : sendQuoteResult.whatsapp}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

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

            {job.assigned_vet_id && (
              <Card title="Messages">
                <MessageThread jobId={id} currentUserId={user?.id} />
              </Card>
            )}
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
/**
 * Explains why a job was or wasn't offered to anyone.
 *
 * Collapsed by default — it's a troubleshooting tool, not part of the
 * normal flow. Worth having because dispatch producing no offer is
 * otherwise silent: the job just sits there and the vet sees nothing.
 */
function RedispatchButton({ jobId, dispatchState, hasVet, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Wording follows the current state so the action is never ambiguous:
  // re-offering a job that already has a vet is a meaningfully different
  // decision from offering one nobody has seen.
  const label = hasVet
    ? 'Offer to a different vet'
    : dispatchState === 'offered'
      ? 'Re-offer (skip current vet)'
      : 'Offer to vets now';

  const run = async () => {
    if (hasVet && !window.confirm(
      'This job already has a vet. Offering it again will look for another vet — continue?'
    )) return;
    setBusy(true);
    setError('');
    try {
      await redispatchJob(jobId);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <p style={styles.assignError}>{error}</p>}
      <button onClick={run} disabled={busy} style={styles.assignBtn}>
        {busy ? 'Offering…' : label}
      </button>
    </>
  );
}

function DispatchDebug({ jobId }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setOpen(true);
    setError('');
    try {
      setData(await fetchDispatchDebug(jobId));
    } catch (err) {
      setError(err.message);
    }
  };

  if (!open) {
    return (
      <button onClick={load} style={styles.debugLink}>
        Why isn&apos;t this offered to anyone?
      </button>
    );
  }

  return (
    <div style={styles.debugBox}>
      {error && <p style={styles.assignError}>{error}</p>}
      {!data ? (
        <p style={styles.docHint}>Checking…</p>
      ) : (
        <>
          <p style={styles.debugSummary}>{data.summary}</p>
          {!data.job.hasCoordinates && (
            <p style={styles.docHint}>
              This address has no map coordinates, so drawn territories can&apos;t be used — matching
              falls back to postcode {data.job.postcode}.
            </p>
          )}
          {data.candidates.map((c) => (
            <div key={c.vetId} style={styles.debugRow}>
              <span style={styles.debugName}>{c.name}</span>
              <span style={styles.debugScore}>{c.score}</span>
              <span style={styles.debugWhy}>
                {c.territory}
                {c.excludedReasons.length > 0 && ` — ${c.excludedReasons.join('; ')}`}
              </span>
            </div>
          ))}
          {data.candidates.length === 0 && (
            <p style={styles.docHint}>No active vet accounts found.</p>
          )}
        </>
      )}
      <button onClick={() => setOpen(false)} style={styles.debugLink}>Hide</button>
    </div>
  );
}

function AssignVetControl({ job, onAssigned }) {
  const [vets, setVets] = useState(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || vets) return;
    fetchVets()
      .then((list) => setVets(list.filter((v) => v.is_active)))
      .catch(() => setError('Could not load the vet list.'));
  }, [open, vets]);

  const onSubmit = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await assignVet(job.id, selected);
      setOpen(false);
      onAssigned();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={styles.assignBtn}>
        {job.assigned_vet_id ? 'Reassign vet' : 'Assign a vet manually'}
      </button>
    );
  }

  return (
    <div style={styles.assignBox}>
      {error && <p style={styles.assignError}>{error}</p>}
      {!vets ? (
        <p style={styles.docHint}>Loading vets…</p>
      ) : vets.length === 0 ? (
        <p style={styles.docHint}>No active vets to assign yet.</p>
      ) : (
        <>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} style={styles.assignSelect}>
            <option value="">Choose a vet…</option>
            {vets.map((v) => (
              <option key={v.id} value={v.id}>
                {v.full_name}{v.suburb ? ` — ${v.suburb}` : ''}
              </option>
            ))}
          </select>
          <div style={styles.assignActions}>
            <button onClick={() => setOpen(false)} style={styles.assignCancel}>Cancel</button>
            <button onClick={onSubmit} disabled={busy || !selected} style={styles.assignConfirm}>
              {busy ? 'Assigning…' : 'Assign'}
            </button>
          </div>
          <p style={styles.docHint}>
            Assigning manually skips the offer/accept step — the vet is booked straight in, and their
            details appear on the client's consent form.
          </p>
        </>
      )}
    </div>
  );
}

function RefundCard({ job, onChanged }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const alreadyRefunded = Number(job.refunded_amount) || 0;
  const fullyRefunded = job.payment_status === 'refunded';

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await refundJob(job.id, {
        // Blank = refund everything still outstanding.
        amount: amount.trim() ? Number(amount) : undefined,
        reason: reason.trim() || null,
        manual,
      });
      setOpen(false);
      setAmount('');
      setReason('');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (fullyRefunded) {
    return (
      <>
        <p style={styles.cancelledNote}>
          Fully refunded — ${alreadyRefunded.toFixed(2)}
          {job.refunded_at ? ` on ${new Date(job.refunded_at).toLocaleDateString('en-AU')}` : ''}.
        </p>
        {job.refund_reason && <p style={styles.docHint}>{job.refund_reason}</p>}
      </>
    );
  }

  return (
    <>
      {alreadyRefunded > 0 && (
        <p style={styles.docHint}>
          Partially refunded: ${alreadyRefunded.toFixed(2)} returned so far.
        </p>
      )}

      {!open ? (
        <button onClick={() => setOpen(true)} style={styles.cancelJobBtn}>Refund this payment</button>
      ) : (
        <>
          {error && <p style={styles.assignError}>{error}</p>}
          <label style={styles.docHint}>Amount (leave blank to refund the full remaining amount)</label>
          <input
            type="number" min="0" step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Full remaining amount"
            style={styles.notesArea}
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            style={styles.notesArea}
          />
          <label style={styles.refundModeRow}>
            <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
            <span>
              Already refunded outside the system
              <br />
              <span style={styles.docHint}>
                Tick only if you've already returned the money by bank transfer or cash. eWay will
                NOT be charged again — this just records it.
              </span>
            </span>
          </label>
          <div style={styles.assignActions}>
            <button onClick={() => setOpen(false)} style={styles.assignCancel}>Cancel</button>
            <button onClick={submit} disabled={busy} style={styles.cancelJobBtn}>
              {busy ? 'Processing…' : manual ? 'Record refund' : 'Refund via eWay'}
            </button>
          </div>
        </>
      )}
    </>
  );
}

function AdminNotesCard({ jobId, initial }) {
  const [notes, setNotes] = useState(initial || '');
  const [status, setStatus] = useState('idle');

  const save = async () => {
    setStatus('saving');
    try {
      await saveAdminNotes(jobId, notes);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  return (
    <>
      <p style={styles.docHint}>
        Operational instructions the assigned vet will see — parking, who'll be present, anything
        they should know before arriving. The vet gets a notification when you save this.
      </p>
      <textarea
        value={notes}
        onChange={(e) => { setNotes(e.target.value); setStatus('idle'); }}
        rows={3}
        placeholder="e.g. Park in the rear lane. Client's daughter will be present."
        style={styles.notesArea}
      />
      <button onClick={save} disabled={status === 'saving'} style={styles.journeySendBtn}>
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved — vet notified' : 'Save notes'}
      </button>
      {status === 'error' && <p style={styles.assignError}>Could not save — try again.</p>}
    </>
  );
}

function CancelCard({ job, onChanged }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const doCancel = async () => {
    setBusy(true);
    setError('');
    try {
      await cancelJob(job.id, reason.trim());
      setConfirming(false);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const doReinstate = async () => {
    setBusy(true);
    setError('');
    try {
      await reinstateJob(job.id);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (job.status === 'cancelled') {
    return (
      <>
        <p style={styles.cancelledNote}>
          This job is cancelled{job.cancellation_reason ? ` — ${job.cancellation_reason}` : ''}.
        </p>
        {error && <p style={styles.assignError}>{error}</p>}
        <button onClick={doReinstate} disabled={busy} style={styles.journeySendBtn}>
          {busy ? 'Reinstating…' : 'Reinstate this job'}
        </button>
      </>
    );
  }

  if (!confirming) {
    return (
      <>
        <p style={styles.docHint}>Current status: <strong>{job.status.replace(/_/g, ' ')}</strong></p>
        {error && <p style={styles.assignError}>{error}</p>}
        <button onClick={() => setConfirming(true)} style={styles.cancelJobBtn}>Cancel this job</button>
      </>
    );
  }

  return (
    <>
      <p style={styles.docHint}>
        The assigned vet is notified immediately by push and text — they may already be on their way.
      </p>
      {error && <p style={styles.assignError}>{error}</p>}
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional, shown to the vet)"
        style={styles.notesArea}
      />
      <div style={styles.assignActions}>
        <button onClick={() => setConfirming(false)} style={styles.assignCancel}>Keep job</button>
        <button onClick={doCancel} disabled={busy} style={styles.cancelJobBtn}>
          {busy ? 'Cancelling…' : 'Confirm cancel'}
        </button>
      </div>
    </>
  );
}

function StatusChip({ label, done }) {
  return <span className={`gm-badge ${done ? 'gm-badge--forest' : 'gm-badge--brick'}`}>{done ? '✓' : '○'} {label}</span>;
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
  consentBtn: { width: '100%', background: '#fff', color: 'var(--gm-forest)', border: '1px solid var(--gm-forest)', borderRadius: 'var(--gm-radius-sm)', padding: '8px', fontSize: 12, fontWeight: 500, marginBottom: 10 },
  editBtn: { marginTop: 12, width: '100%', background: '#fff', color: 'var(--gm-forest)', border: '1px solid var(--gm-forest)', borderRadius: 'var(--gm-radius-sm)', padding: '9px', fontSize: 13, fontWeight: 500 },
  clientName: { fontFamily: 'var(--gm-font-display)', fontSize: 16, fontWeight: 600, marginBottom: 6 },
  contactLink: { display: 'block', color: 'var(--gm-forest)', fontSize: 14, fontWeight: 500, textDecoration: 'none', padding: '3px 0' },
  plain: { fontSize: 14, margin: 0 },
  enRouteNote: { fontSize: 13, color: 'var(--gm-forest-dark)', marginTop: 10, lineHeight: 1.5 },
  notes: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 8, fontStyle: 'italic' },
  billLine: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' },
  billTotal: { borderTop: '1px solid var(--gm-line)', marginTop: 6, paddingTop: 8, fontWeight: 600 },
  paidNote: { fontSize: 13, color: 'var(--gm-forest-dark)', marginTop: 12, fontWeight: 500 },
  takePaymentBtn: { width: '100%', background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '10px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500, marginTop: 14 },
  docRow: { display: 'flex', flexDirection: 'column', gap: 8 },
  sendEverywhereRow: { marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--gm-line)' },
  sendEverywhereBtn: { width: '100%', background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '10px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500 },
  sendEverywhereResult: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  journeyStatusRow: { display: 'flex', gap: 8, marginBottom: 12 },
  journeyLinkRow: { display: 'flex', gap: 6, marginBottom: 10 },
  journeyLinkInput: { flex: 1, padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 12, background: 'var(--gm-line-soft)', color: 'var(--gm-ink-soft)' },
  journeyCopyBtn: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '8px 12px', fontSize: 12, fontWeight: 500, flexShrink: 0 },
  journeySendBtn: { width: '100%', background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '9px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500 },
  journeySentNote: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 8, fontStyle: 'italic' },
  assignBtn: { marginTop: 12, width: '100%', background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '9px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500 },
  assignBox: { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--gm-line)' },
  assignSelect: { width: '100%', padding: '9px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, background: '#fff' },
  assignActions: { display: 'flex', gap: 8, marginTop: 10 },
  assignCancel: { flex: 1, background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '9px 0', fontSize: 13, fontWeight: 500 },
  assignConfirm: { flex: 1, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '9px 0', fontSize: 13, fontWeight: 500 },
  chargesBlock: { marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--gm-line-soft)' },
  notesArea: { width: '100%', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', marginBottom: 8, background: '#fff' },
  cancelJobBtn: { flex: 1, width: '100%', background: 'var(--gm-brick)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '9px', fontSize: 13, fontWeight: 500 },
  refundModeRow: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, marginBottom: 10 },
  cancelledNote: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 10, fontWeight: 500 },
  debugLink: { background: 'none', border: 'none', color: 'var(--gm-ink-soft)', fontSize: 11, textDecoration: 'underline', padding: '8px 0 0', cursor: 'pointer' },
  debugBox: { marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--gm-line-soft)' },
  debugSummary: { fontSize: 12, fontWeight: 500, marginBottom: 8 },
  debugRow: { display: 'flex', gap: 8, fontSize: 11, padding: '4px 0', borderBottom: '1px solid var(--gm-line-soft)', alignItems: 'baseline' },
  debugName: { fontWeight: 500, minWidth: 90 },
  debugScore: { color: 'var(--gm-ink-soft)', minWidth: 30, textAlign: 'right' },
  debugWhy: { flex: 1, color: 'var(--gm-ink-soft)', lineHeight: 1.4 },
  assignError: { fontSize: 12, color: 'var(--gm-brick)', marginBottom: 8 },
  docItemRow: { display: 'flex', alignItems: 'center', gap: 8 },
  docLabel: { fontSize: 13, fontWeight: 500, flex: 1 },
  docBtn: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '7px 12px', fontSize: 12, fontWeight: 500 },
  docError: { fontSize: 11, color: 'var(--gm-brick)' },
  docHint: { fontSize: 12, color: 'var(--gm-ink-soft)', fontStyle: 'italic', margin: 0 },
};
