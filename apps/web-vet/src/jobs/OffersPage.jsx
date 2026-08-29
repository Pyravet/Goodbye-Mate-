import { useEffect, useState, useCallback } from 'react';
import AppShell from '../layout/AppShell.jsx';
import { fetchMyOffers, acceptOffer, declineOffer, proposeTime } from './jobsApi.js';
import { formatTime } from '@goodbye-mate/web-shared/src/format.js';

const HANDLING_LABELS = {
  not_needed: 'Small pet — no help needed',
  client_helps: 'Someone at home will help carry',
  direct_pickup: 'Cremation partner collects directly',
  assistant: 'A second person is coming to help',
  needs_help: 'Nobody can help carry',
};
const PACE_LABELS = {
  slow: 'Slow and unhurried — the family want time',
  normal: 'Normal pace',
  quick: 'Keep it brief',
};

const SERVICE_LABELS = {
  euthanasia_only: 'Euthanasia only',
  private_cremation: 'Private cremation',
  communal_cremation: 'Communal cremation',
};

function formatDay(dateStr) {
  return new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function timeLeft(expiresAt) {
  if (!expiresAt) return null;
  const mins = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000);
  if (mins <= 0) return 'Expired';
  if (mins < 60) return `${mins} min left to respond`;
  return `${Math.round(mins / 60)}h left to respond`;
}

/**
 * Job offers — deliberately its own screen, not a section of the jobs
 * list.
 *
 * An offer is a decision waiting on the vet, not work they already hold.
 * Mixed into the jobs list it gets scrolled past; on its own screen with
 * a count in the tab bar it's obvious there's something to answer.
 *
 * Client name, phone and address are NOT shown here — the server
 * withholds them until a vet accepts, so a job broadcast to several vets
 * doesn't hand one client's details to everyone who was asked.
 */
export default function OffersPage() {
  const [offers, setOffers] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [proposingId, setProposingId] = useState(null);

  const load = useCallback(() => {
    fetchMyOffers()
      .then(setOffers)
      .catch((err) => { setError(err.message); setOffers([]); });
  }, []);

  useEffect(() => {
    load();
    // Offers expire, and another vet accepting removes them, so keep
    // this current rather than letting a vet act on a dead offer.
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (id, fn) => {
    setBusyId(id);
    setError('');
    try {
      await fn(id);
      load();
    } catch (err) {
      setError(err.message);
      load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Job offers</h1>

        {error && <p style={styles.error}>{error}</p>}

        {offers === null ? (
          <p style={styles.empty}>Loading…</p>
        ) : offers.length === 0 ? (
          <p style={styles.empty}>
            No offers right now. You'll get a notification when a job is offered to you.
          </p>
        ) : (
          offers.map((o) => (
            <div key={o.offer_id} className="gm-card" style={styles.card}>
              <div style={styles.cardTop}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Every pet, not just the first. A double euthanasia
                      was being offered as though it were a single visit
                      — the wrong work and the wrong money. */}
                  {(o.pets?.length ? o.pets : [{ name: o.pet_name, species: o.pet_type, breed: o.pet_breed, weight: o.pet_weight }])
                    .map((p, i) => (
                      <div key={i} style={i > 0 ? styles.extraPet : undefined}>
                        <div style={styles.petName}>{p.name}</div>
                        <div style={styles.meta}>
                          {[p.species, p.breed, p.weight].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    ))}
                  {o.pets?.length > 1 && (
                    <div style={styles.multiFlag}>
                      {o.pets.length} pets in this visit
                    </div>
                  )}
                </div>
                {o.outcome === 'proposed' && (
                  <span className="gm-badge gm-badge--honey">Time suggested</span>
                )}
              </div>

              <div style={styles.detail}>
                <Row label="When" value={`${formatDay(o.job_date)} at ${formatTime(o.job_time)}`} />
                <Row label="Where" value={[o.suburb, o.state, o.postcode].filter(Boolean).join(' ')} />
                <Row label="Service" value={SERVICE_LABELS[o.service_type] || o.service_type} />
                {o.notes && <Row label="From the booking" value={o.notes} />}
                {/* Why this is happening. A vet is entitled to know the
                    reason and the family's situation BEFORE agreeing to
                    attend, not after. */}
                {o.admin_notes && <Row label="From the office" value={o.admin_notes} />}
                <Row label="Carrying" value={HANDLING_LABELS[o.handling_help] || '—'} />
                {o.pace && o.pace !== 'normal' && (
                  <Row label="Pace" value={PACE_LABELS[o.pace]} />
                )}
                {o.handling_notes && <Row label="Access" value={o.handling_notes} />}
                {/* What it pays. A vet was previously accepting without
                    knowing the amount — agreeing to drive somewhere for
                    a figure they'd only discover afterwards. */}
                {o.payout != null && (
                  <Row label="You'd earn" value={`$${Number(o.payout).toFixed(2)}`} />
                )}
              </div>

              {o.outcome === 'proposed' ? (
                <p style={styles.proposedNote}>
                  You suggested {formatDay(o.proposed_date)} at {formatTime(String(o.proposed_time).slice(0, 5))}.
                  We'll check with the client and come back to you — the offer stays open in the meantime.
                </p>
              ) : (
                <>
                  {o.expires_at && <p style={styles.expiry}>{timeLeft(o.expires_at)}</p>}

                  {proposingId === o.id ? (
                    <ProposeForm
                      jobId={o.id}
                      onCancel={() => setProposingId(null)}
                      onDone={() => { setProposingId(null); load(); }}
                      onError={setError}
                    />
                  ) : (
                    <>
                      <div style={styles.actions}>
                        <button
                          onClick={() => act(o.id, declineOffer)}
                          disabled={busyId === o.id}
                          style={styles.declineBtn}
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => act(o.id, acceptOffer)}
                          disabled={busyId === o.id}
                          style={styles.acceptBtn}
                        >
                          {busyId === o.id ? '…' : 'Accept'}
                        </button>
                      </div>
                      <button onClick={() => setProposingId(o.id)} style={styles.suggestBtn}>
                        Suggest a different time
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}

function ProposeForm({ jobId, onCancel, onDone, onError }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!date || !time) return;
    setBusy(true);
    try {
      await proposeTime(jobId, { date, time, note: note.trim() || null });
      onDone();
    } catch (err) {
      onError(err.message);
      setBusy(false);
    }
  };

  return (
    <div style={styles.proposeBox}>
      <p style={styles.proposeHint}>
        This is a suggestion, not a booking — we'll check it with the client first.
      </p>
      <div style={styles.proposeRow}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={styles.input} />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={styles.input} />
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything to add? (optional)"
        style={styles.input}
      />
      <div style={styles.actions}>
        <button onClick={onCancel} style={styles.declineBtn}>Cancel</button>
        <button onClick={submit} disabled={busy || !date || !time} style={styles.acceptBtn}>
          {busy ? 'Sending…' : 'Send suggestion'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={styles.rowValue}>{value}</span>
    </div>
  );
}

const styles = {
  page: { padding: '20px 16px' },
  title: { fontSize: 22, marginBottom: 14 },
  empty: { color: 'var(--gm-ink-soft)', fontSize: 14, lineHeight: 1.6 },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 12 },
  card: { padding: 16, marginBottom: 12 },
  cardTop: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 },
  petName: { fontFamily: 'var(--gm-font-display)', fontSize: 19, fontWeight: 600 },
  meta: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  extraPet: { marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--gm-line)' },
  multiFlag: { fontSize: 11, fontWeight: 600, color: '#7A5A22', background: 'var(--gm-honey-soft)', padding: '3px 8px', borderRadius: 999, display: 'inline-block', marginTop: 6 },
  detail: { borderTop: '1px solid var(--gm-line-soft)', paddingTop: 10, marginBottom: 10 },
  row: { display: 'flex', gap: 10, fontSize: 14, padding: '3px 0' },
  rowLabel: { width: 62, color: 'var(--gm-ink-soft)', flexShrink: 0, fontSize: 12 },
  rowValue: { flex: 1, minWidth: 0 },
  expiry: { fontSize: 12, color: 'var(--gm-brick)', marginBottom: 10, fontWeight: 500 },
  actions: { display: 'flex', gap: 8 },
  acceptBtn: { flex: 1, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '12px 0', fontSize: 15, fontWeight: 500 },
  declineBtn: { flex: 1, background: '#fff', color: 'var(--gm-ink-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '12px 0', fontSize: 15, fontWeight: 500 },
  suggestBtn: { width: '100%', background: 'none', border: 'none', color: 'var(--gm-forest)', fontSize: 13, textDecoration: 'underline', padding: '12px 0 2px' },
  proposeBox: { borderTop: '1px solid var(--gm-line-soft)', paddingTop: 10 },
  proposeHint: { fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 8, lineHeight: 1.4 },
  proposeRow: { display: 'flex', gap: 8 },
  input: { width: '100%', padding: '10px 12px', marginBottom: 8, borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 15, fontFamily: 'inherit', background: '#fff' },
  proposedNote: { fontSize: 13, color: '#7A5A22', background: 'var(--gm-honey-soft)', padding: '10px 12px', borderRadius: 'var(--gm-radius-sm)', lineHeight: 1.5 },
};
