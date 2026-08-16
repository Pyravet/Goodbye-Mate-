import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import { fetchJob, acceptOffer, declineOffer, markProcedureDone, saveMedicalNotes, notifyEnRoute } from './jobsApi.js';
import MessageThread from './MessageThread.jsx';
import { useAuth } from '../AuthContext.jsx';

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(true);
  const [enRouteState, setEnRouteState] = useState('idle'); // idle | locating | sending | done | error
  const [enRouteError, setEnRouteError] = useState('');
  const [enRouteResult, setEnRouteResult] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchJob(id).then((d) => { setData(d); setNotes(d.job.medical_notes || ''); }).catch(() => setData(null)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const onAccept = async () => { setBusy(true); try { await acceptOffer(id); load(); } finally { setBusy(false); } };
  const onDecline = async () => { setBusy(true); try { await declineOffer(id); navigate('/'); } finally { setBusy(false); } };
  const onProcedureDone = async () => { setBusy(true); try { await markProcedureDone(id); load(); } finally { setBusy(false); } };
  const onNotifyEnRoute = () => {
    if (!('geolocation' in navigator)) {
      setEnRouteState('error');
      setEnRouteError("This device can't share its location.");
      return;
    }
    setEnRouteState('locating');
    setEnRouteError('');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setEnRouteState('sending');
        try {
          const result = await notifyEnRoute(id, {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setEnRouteResult(result);
          setEnRouteState('done');
        } catch (err) {
          setEnRouteState('error');
          setEnRouteError(err.message);
        }
      },
      () => {
        setEnRouteState('error');
        setEnRouteError('Location permission was denied — enable it to send an ETA.');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const onSaveNotes = async () => {
    setBusy(true);
    try { await saveMedicalNotes(id, notes); setNotesSaved(true); } finally { setBusy(false); }
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
                  {enRouteResult.smsSent ? 'Client texted' : 'Client not texted (SMS unavailable)'} — ETA {enRouteResult.etaMinutes} min ({enRouteResult.distanceText}).
                </p>
                <button onClick={onNotifyEnRoute} disabled={enRouteState === 'locating' || enRouteState === 'sending'} style={styles.enRouteBtnSecondary}>
                  Send updated ETA
                </button>
              </>
            ) : (
              <>
                <p style={styles.subline2}>Let the client know you're on the way, with a live ETA based on your current location.</p>
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
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setNotesSaved(false); }}
              rows={5}
              placeholder="Private notes — never shown to the client automatically."
              style={styles.textarea}
            />
            <button onClick={onSaveNotes} disabled={busy || notesSaved} style={styles.saveBtn}>
              {notesSaved ? 'Saved' : busy ? 'Saving…' : 'Save notes'}
            </button>
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
  errorNote: { fontSize: 12, color: 'var(--gm-brick)', marginTop: 8 },
  doneBtn: { width: '100%', padding: '12px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 14, fontWeight: 500 },
  textarea: { width: '100%', padding: '10px 12px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 15, resize: 'vertical', fontFamily: 'inherit' },
  saveBtn: { marginTop: 10, padding: '10px 16px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 14, fontWeight: 500 },
};
