import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import { fetchJob, acceptOffer, declineOffer, markProcedureDone, notifyEnRoute, openVetRecord, emailVetRecord } from './jobsApi.js';
import VetRecordCard from '@goodbye-mate/web-shared/src/VetRecordCard.jsx';
import { fetchMedicalNotes, addMedicalNote } from './jobsApi.js';
import MessageThread from './MessageThread.jsx';
import { useAuth } from '../AuthContext.jsx';

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [enRouteState, setEnRouteState] = useState('idle'); // idle | locating | sending | done | error
  const [enRouteError, setEnRouteError] = useState('');
  const [enRouteResult, setEnRouteResult] = useState(null);
  const [manualEta, setManualEta] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetchJob(id).then((d) => { setData(d); }).catch(() => setData(null)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const onAccept = async () => { setBusy(true); try { await acceptOffer(id); load(); } finally { setBusy(false); } };
  const onDecline = async () => { setBusy(true); try { await declineOffer(id); navigate('/'); } finally { setBusy(false); } };
  const onProcedureDone = async () => { setBusy(true); try { await markProcedureDone(id); load(); } finally { setBusy(false); } };
  const onNotifyEnRoute = () => {
    setEnRouteError('');
    const eta = manualEta ? Number(manualEta) : undefined;

    const send = async (coords) => {
      setEnRouteState('sending');
      try {
        setEnRouteResult(await notifyEnRoute(id, { ...coords, etaMinutes: eta }));
        setEnRouteState('done');
      } catch (err) {
        setEnRouteState('error');
        setEnRouteError(err.message);
      }
    };

    // Location is a bonus, not a requirement. Refusing to send without
    // it meant a vet who declined the browser prompt — or was somewhere
    // with no GPS — could not tell the client they were coming at all.
    if (!('geolocation' in navigator)) {
      send({});
      return;
    }

    setEnRouteState('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => send({ lat: position.coords.latitude, lng: position.coords.longitude }),
      // Denied or unavailable: send anyway. The client cares far more
      // that someone is on the way than about a precise ETA.
      () => send({}),
      { timeout: 8000 }
    );
  };


  if (loading) return <AppShell><div style={styles.page}>Loading…</div></AppShell>;
  if (!data) return <AppShell><div style={styles.page}>Job not found.</div></AppShell>;

  const { job } = data;
  const isOffer = job.dispatch_state === 'offered';

  return (
    <AppShell>
      <div style={styles.page}>
        <Link to="/" style={styles.back}>← Jobs</Link>

        <h1 style={styles.title}>{job.pet_name}</h1>
        <p style={styles.subtitle}>{job.job_number} · {new Date(job.job_date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })} at {job.job_time}</p>
        {job.pet_behaviour && job.pet_behaviour !== 'Friendly' && (
          <span className="gm-badge gm-badge--honey" style={{ marginTop: 8 }}>{job.pet_behaviour}</span>
        )}

        {isOffer && (
          <div style={styles.offerBar}>
            <button onClick={onDecline} disabled={busy} style={styles.declineBtn}>Decline</button>
            <button onClick={onAccept} disabled={busy} style={styles.acceptBtn}>Accept offer</button>
          </div>
        )}

        {job.admin_notes && (
          <div className="gm-card" style={styles.adminNoteCard}>
            <h3 style={styles.adminNoteTitle}>📌 Note from admin</h3>
            <p style={styles.adminNoteBody}>{job.admin_notes}</p>
          </div>
        )}

        {job.status === 'cancelled' && (
          <div className="gm-card" style={styles.cancelledCard}>
            <h3 style={styles.cancelledTitle}>This job was cancelled</h3>
            {job.cancellation_reason && <p style={styles.adminNoteBody}>{job.cancellation_reason}</p>}
            <p style={styles.cancelledHint}>You don't need to attend. Contact admin if this looks wrong.</p>
          </div>
        )}

        <Card title="Client">
          <p style={styles.plain}>{job.client_name}</p>
          <a href={`tel:${job.client_phone}`} style={styles.callLink}>{job.client_phone}</a>
        </Card>

        <Card title="Address">
          <p style={styles.plain}>{job.address}</p>
          {job.notes && <p style={styles.notes}>{job.notes}</p>}
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}`}
            target="_blank" rel="noreferrer" style={styles.directionsLink}
          >
            Get directions →
          </a>
        </Card>

        {!isOffer && !job.procedure_done && (
          <Card title="On the way">
            {enRouteState === 'done' && enRouteResult ? (
              <>
                <p style={styles.doneNote}>
                  {enRouteResult.smsSent ? 'Client texted' : 'Client not texted (SMS unavailable)'}
                  {/* Only claim an ETA when there is one. It previously
                      rendered "ETA null min (null)" whenever the maps
                      lookup was unavailable. */}
                  {enRouteResult.etaMinutes
                    ? ` — ETA ${enRouteResult.etaMinutes} min${enRouteResult.distanceText ? ` (${enRouteResult.distanceText})` : ''}.`
                    : '.'}
                </p>
                <button onClick={onNotifyEnRoute} disabled={enRouteState === 'locating' || enRouteState === 'sending'} style={styles.enRouteBtnSecondary}>
                  Send updated ETA
                </button>
              </>
            ) : (
              <>
                <p style={styles.subline2}>
                  Let the client know you&apos;re on the way. Add a rough ETA if you have one —
                  you know the drive better than the map does.
                </p>
                <label style={styles.etaRow}>
                  <input
                    type="number" inputMode="numeric" min="1" max="480"
                    value={manualEta}
                    onChange={(e) => setManualEta(e.target.value)}
                    placeholder="25"
                    style={styles.etaInput}
                  />
                  <span style={styles.etaUnit}>minutes away (optional)</span>
                </label>
                <button onClick={onNotifyEnRoute} disabled={enRouteState === 'locating' || enRouteState === 'sending'} style={styles.enRouteBtn}>
                  {enRouteState === 'locating' ? 'Finding your location…' : enRouteState === 'sending' ? 'Sending…' : "I'm on the way — notify client"}
                </button>
              </>
            )}
            {enRouteState === 'error' && <p style={styles.errorNote}>{enRouteError}</p>}
          </Card>
        )}

        <Card title="Pet">
          <p style={styles.plain}>{job.pet_type}{job.pet_breed ? `, ${job.pet_breed}` : ''}</p>
          <p style={styles.subline2}>{[job.pet_weight, job.pet_age].filter(Boolean).join(' · ')}</p>
        </Card>

        {!isOffer && (
          <Card title="Procedure">
            {job.procedure_done ? (
              <p style={styles.doneNote}>Marked as completed.</p>
            ) : (
              <button onClick={onProcedureDone} disabled={busy} style={styles.doneBtn}>Mark procedure done</button>
            )}
          </Card>
        )}

        {!isOffer && (
          <Card title="Medical notes">
            <MedicalNotesLog jobId={id} onChanged={load} />
          </Card>
        )}

        {!isOffer && (
          <Card title="Veterinary record">
            <VetRecordCard
              clientEmail={job.client_email}
              hasNotes={!!(job.medical_notes && job.medical_notes.trim())}
              onOpen={() => openVetRecord(id)}
              onEmail={(payload) => emailVetRecord(id, payload)}
            />
          </Card>
        )}

        {!isOffer && (
          <Card title="Messages">
            <MessageThread jobId={id} currentUserId={user?.id} />
          </Card>
        )}
      </div>
    </AppShell>
  );
}

/**
 * Medical notes as an append-only log.
 *
 * Entries are never edited: a clinical note records what was observed at
 * a moment in time, and silently rewriting one after the fact is exactly
 * what makes a record indefensible if an insurer or complaint puts it
 * under scrutiny. Corrections go in as a new, separately timestamped
 * entry — which is also how paper clinical records work.
 */
function MedicalNotesLog({ jobId, onChanged }) {
  const [entries, setEntries] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchMedicalNotes(jobId).then(setEntries).catch(() => setEntries([]));
  }, [jobId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    setError('');
    try {
      const updated = await addMedicalNote(jobId, draft.trim());
      setEntries(updated);
      setDraft('');
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {entries === null ? (
        <p style={styles.subline2}>Loading…</p>
      ) : entries.length === 0 ? (
        <p style={styles.subline2}>No notes recorded yet.</p>
      ) : (
        <div style={styles.noteList}>
          {entries.map((e) => (
            <div key={e.id} style={styles.noteEntry}>
              <div style={styles.noteMeta}>
                {new Date(e.created_at).toLocaleString('en-AU', {
                  day: 'numeric', month: 'short', year: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                })}
                {' · '}{e.author_name}
                {e.author_role === 'admin' ? ' (admin)' : ''}
              </div>
              <div style={styles.noteBody}>{e.body}</div>
            </div>
          ))}
        </div>
      )}

      {error && <p style={styles.errorNote}>{error}</p>}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        placeholder="Add a note — it will be timestamped and attributed to you."
        style={styles.textarea}
      />
      <button onClick={add} disabled={saving || !draft.trim()} style={styles.saveBtn}>
        {saving ? 'Saving…' : 'Add note'}
      </button>
      <p style={styles.noteHint}>
        Notes can't be edited or deleted once added — add a follow-up entry to correct or expand on
        anything.
      </p>
    </div>
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

const styles = {
  page: { padding: '20px 16px 32px' },
  adminNoteCard: { padding: 16, marginTop: 16, borderColor: 'var(--gm-honey)', borderWidth: 2, background: 'var(--gm-honey-soft)' },
  adminNoteTitle: { fontSize: 13, fontWeight: 600, color: '#7A5A22', marginBottom: 6 },
  adminNoteBody: { fontSize: 14, lineHeight: 1.5, margin: 0, color: 'var(--gm-ink)' },
  cancelledCard: { padding: 16, marginTop: 16, borderColor: 'var(--gm-brick)', borderWidth: 2, background: 'var(--gm-brick-soft)' },
  cancelledTitle: { fontSize: 14, fontWeight: 600, color: 'var(--gm-brick)', marginBottom: 6 },
  cancelledHint: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 8, fontStyle: 'italic' },
  back: { fontSize: 13, color: 'var(--gm-ink-soft)', textDecoration: 'none' },
  title: { fontSize: 24, marginTop: 10 },
  subtitle: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 4 },
  offerBar: { display: 'flex', gap: 8, marginTop: 16 },
  declineBtn: { flex: 1, padding: '13px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', background: '#fff', fontSize: 15, fontWeight: 500 },
  acceptBtn: { flex: 1, padding: '13px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 15, fontWeight: 500 },
  card: { padding: 16, marginTop: 16 },
  cardTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginBottom: 10, fontFamily: 'var(--gm-font-body)', fontWeight: 600 },
  plain: { fontSize: 15, margin: 0 },
  subline2: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 4 },
  notes: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 8, fontStyle: 'italic' },
  callLink: { display: 'inline-block', marginTop: 6, color: 'var(--gm-forest)', fontSize: 15, fontWeight: 500, textDecoration: 'none' },
  directionsLink: { display: 'inline-block', marginTop: 10, color: 'var(--gm-forest)', fontSize: 14, fontWeight: 500, textDecoration: 'none' },
  doneNote: { fontSize: 14, color: 'var(--gm-forest-dark)' },
  enRouteBtn: { width: '100%', padding: '12px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 14, fontWeight: 500 },
  enRouteBtnSecondary: { width: '100%', padding: '10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', background: '#fff', color: 'var(--gm-ink)', fontSize: 13, fontWeight: 500, marginTop: 4 },
  etaRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  etaInput: { width: 76, padding: '11px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 16, textAlign: 'center', minHeight: 44 },
  etaUnit: { fontSize: 13, color: 'var(--gm-ink-soft)' },
  errorNote: { fontSize: 12, color: 'var(--gm-brick)', marginTop: 8 },
  doneBtn: { width: '100%', padding: '12px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 14, fontWeight: 500 },
  noteList: { marginBottom: 12 },
  noteEntry: { paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid var(--gm-line-soft)' },
  noteMeta: { fontSize: 11, color: 'var(--gm-ink-soft)', marginBottom: 4 },
  noteBody: { fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  noteHint: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 8, fontStyle: 'italic', lineHeight: 1.4 },
  textarea: { width: '100%', padding: '10px 12px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 15, resize: 'vertical', fontFamily: 'inherit' },
  saveBtn: { marginTop: 10, padding: '10px 16px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 14, fontWeight: 500 },
};
