import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext.jsx';
import { LOGO_DATA_URI } from '../assets.js';
import { fetchMyClinic, fetchMyReferrals, submitReferral } from './clinicApi.js';

const EMPTY = {
  clientName: '', clientPhone: '', clientEmail: '',
  petName: '', petType: '', petBreed: '',
  suburb: '', postcode: '',
  servicePreference: '', preferredTiming: '', message: '',
};

const SERVICE_OPTIONS = [
  'Not sure yet',
  'Euthanasia only',
  'Euthanasia + private cremation (ashes returned)',
  'Euthanasia + communal cremation',
];

/**
 * Clinic portal.
 *
 * A clinic refers a client and can then see what happened. Today they
 * hand over a phone number and never find out whether the family was
 * looked after — which is the whole reason this exists, before any
 * question of commission.
 *
 * They see the OUTCOME of their own referrals only: no address, no
 * pricing, no vet details, no clinical notes. The server enforces that;
 * this screen simply has nothing else to show.
 */
export default function ClinicPortal() {
  const { user, logout } = useAuth();
  const [clinic, setClinic] = useState(null);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('refer');
  const [error, setError] = useState('');
  // Distinguished from a transient error: an account that isn't linked
  // to a clinic, or whose clinic is deactivated, can never submit.
  // Showing the form anyway means filling it in and being rejected at
  // the end — after typing a grieving client's details.
  const [blocked, setBlocked] = useState(null);

  const load = useCallback(() => {
    fetchMyReferrals().then(setData).catch((e) => { setError(e.message); setData({ referrals: [] }); });
  }, []);

  useEffect(() => {
    fetchMyClinic()
      .then(setClinic)
      .catch((e) => setBlocked(e.message));
    load();
  }, [load]);

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <img src={LOGO_DATA_URI} alt="Goodbye Mate" style={styles.logo} />
        <div style={styles.headerRight}>
          <span style={styles.clinicName}>{clinic?.name || ''}</span>
          <button onClick={logout} style={styles.logout}>Sign out</button>
        </div>
      </header>

      {!blocked && (
      <div style={styles.tabs}>
        <button
          onClick={() => setTab('refer')}
          style={{ ...styles.tab, ...(tab === 'refer' ? styles.tabOn : {}) }}
        >
          Refer a client
        </button>
        <button
          onClick={() => { setTab('list'); load(); }}
          style={{ ...styles.tab, ...(tab === 'list' ? styles.tabOn : {}) }}
        >
          Your referrals{data?.stats ? ` (${data.stats.total})` : ''}
        </button>
      </div>
      )}

      <main style={styles.main}>
        {blocked ? (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>This account can&apos;t submit referrals</h2>
            <p style={styles.intro}>{blocked}</p>
            <p style={styles.intro}>
              Please get in touch and we&apos;ll sort it out.
            </p>
          </div>
        ) : (
          <>
        {error && <p style={styles.error}>{error}</p>}

        {tab === 'refer'
          ? <ReferralForm onSent={() => { load(); setTab('list'); }} userName={user?.fullName} />
          : <ReferralList data={data} />}
          </>
        )}
      </main>
    </div>
  );
}

function ReferralForm({ onSent, userName }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await submitReferral(form);
      setForm(EMPTY);
      setSent(true);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div style={styles.card}>
        <h2 style={styles.doneTitle}>Referral sent</h2>
        <p style={styles.doneText}>
          We&apos;ll contact the family directly, usually within a couple of hours during the
          day. You&apos;ll see the outcome under <strong>Your referrals</strong>.
        </p>
        <div style={styles.row}>
          <button onClick={() => { setSent(false); setBusy(false); }} style={styles.secondaryBtn}>
            Refer someone else
          </button>
          <button onClick={onSent} style={styles.primaryBtn}>See your referrals</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={styles.card}>
      <h2 style={styles.cardTitle}>Refer a client</h2>
      <p style={styles.intro}>
        We&apos;ll contact them directly to arrange an at-home visit. Only the client&apos;s
        contact details and the pet are needed — we&apos;ll take the rest from there.
      </p>

      {error && <p style={styles.error}>{error}</p>}

      <h3 style={styles.section}>The client</h3>
      <Field label="Name" required>
        <input value={form.clientName} onChange={set('clientName')} required style={styles.input} />
      </Field>
      <div style={styles.row}>
        <Field label="Phone" required>
          <input type="tel" value={form.clientPhone} onChange={set('clientPhone')} required style={styles.input} />
        </Field>
        <Field label="Email">
          <input type="email" value={form.clientEmail} onChange={set('clientEmail')} style={styles.input} />
        </Field>
      </div>
      <div style={styles.row}>
        <Field label="Suburb">
          <input value={form.suburb} onChange={set('suburb')} style={styles.input} />
        </Field>
        <Field label="Postcode">
          <input value={form.postcode} onChange={set('postcode')} style={styles.input} />
        </Field>
      </div>

      <h3 style={styles.section}>The pet</h3>
      <div style={styles.row}>
        <Field label="Name" required>
          <input value={form.petName} onChange={set('petName')} required style={styles.input} />
        </Field>
        <Field label="Type">
          <input value={form.petType} onChange={set('petType')} placeholder="Dog" style={styles.input} />
        </Field>
        <Field label="Breed">
          <input value={form.petBreed} onChange={set('petBreed')} style={styles.input} />
        </Field>
      </div>

      <h3 style={styles.section}>What they&apos;re after</h3>
      <Field label="Service">
        <select value={form.servicePreference} onChange={set('servicePreference')} style={styles.input}>
          <option value="">Not specified</option>
          {SERVICE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Timing">
        <input
          value={form.preferredTiming} onChange={set('preferredTiming')}
          placeholder="e.g. As soon as possible, or Thursday afternoon" style={styles.input}
        />
      </Field>
      <Field label="Anything we should know">
        <textarea
          value={form.message} onChange={set('message')} rows={3}
          placeholder="Clinical background, the family's situation, anything that would help us handle this well"
          style={styles.input}
        />
      </Field>

      <p style={styles.consentNote}>
        Please make sure the client is expecting our call before you send this.
      </p>

      <button type="submit" disabled={busy} style={styles.primaryBtn}>
        {busy ? 'Sending…' : 'Send referral'}
      </button>
      {userName && <p style={styles.byline}>Sending as {userName}</p>}
    </form>
  );
}

function ReferralList({ data }) {
  if (!data) return <p style={styles.empty}>Loading…</p>;
  const { referrals, stats } = data;

  return (
    <>
      {stats && (
        <div style={styles.statRow}>
          <Stat label="Referred" value={stats.total} />
          <Stat label="Became a visit" value={stats.converted} />
          <Stat label="Awaiting contact" value={stats.awaiting_contact} />
        </div>
      )}

      {referrals.length === 0 ? (
        <p style={styles.empty}>No referrals yet.</p>
      ) : (
        referrals.map((r) => (
          <div key={r.id} style={styles.refCard}>
            <div style={styles.refTop}>
              <div>
                <div style={styles.refPet}>{r.pet_name}</div>
                <div style={styles.refClient}>{r.client_name}</div>
              </div>
              <span style={{ ...styles.status, ...statusStyle(r) }}>{statusLabel(r)}</span>
            </div>
            <div style={styles.refMeta}>
              Referred {new Date(r.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              {r.job_date && ` · visit ${new Date(`${String(r.job_date).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`}
            </div>
          </div>
        ))
      )}
    </>
  );
}

/**
 * Outcome in the clinic's terms, not ours.
 *
 * Internal statuses like "converted" mean nothing to a referring vet;
 * what they want to know is whether the family was looked after.
 */
function statusLabel(r) {
  if (r.job_status === 'completed') return 'Visit completed';
  if (r.job_number) return 'Booked in';
  if (r.status === 'contacted') return 'We\'ve made contact';
  if (r.status === 'declined') return 'Not proceeding';
  return 'With us — contacting them';
}

function statusStyle(r) {
  if (r.job_status === 'completed' || r.job_number) return styles.statusGood;
  if (r.status === 'declined') return styles.statusOff;
  return styles.statusPending;
}

function Stat({ label, value }) {
  return (
    <div style={styles.stat}>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function Field({ label, children, required }) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}{required && <span style={styles.req}> *</span>}</span>
      {children}
    </label>
  );
}

const styles = {
  shell: { minHeight: '100vh', background: 'var(--gm-paper)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'var(--gm-forest)' },
  logo: { height: 24, filter: 'brightness(0) invert(1)' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
  clinicName: { color: '#fff', fontSize: 13, opacity: 0.9 },
  logout: { background: 'none', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 'var(--gm-radius-sm)', padding: '5px 12px', fontSize: 12 },
  tabs: { display: 'flex', gap: 4, padding: '12px 18px 0', maxWidth: 640, margin: '0 auto' },
  tab: { flex: 1, background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '10px 0', fontSize: 14, color: 'var(--gm-ink-soft)', minHeight: 44 },
  tabOn: { color: 'var(--gm-forest)', borderBottomColor: 'var(--gm-forest)', fontWeight: 600 },
  main: { maxWidth: 640, margin: '0 auto', padding: '16px 18px 48px' },
  card: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius)', padding: 20 },
  cardTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 20, fontWeight: 600, marginBottom: 6 },
  intro: { fontSize: 13, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 18 },
  section: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', margin: '18px 0 10px' },
  field: { display: 'block', flex: 1, minWidth: 0, marginBottom: 12 },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 4 },
  req: { color: 'var(--gm-brick)' },
  input: { width: '100%', padding: '11px 12px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 15, fontFamily: 'inherit', background: '#fff', minHeight: 44 },
  row: { display: 'flex', gap: 8 },
  consentNote: { fontSize: 12, color: '#7A5A22', background: 'var(--gm-honey-soft)', padding: '10px 12px', borderRadius: 'var(--gm-radius-sm)', margin: '8px 0 16px', lineHeight: 1.5 },
  primaryBtn: { width: '100%', background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '13px 0', fontSize: 16, fontWeight: 500, minHeight: 48 },
  secondaryBtn: { flex: 1, background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '13px 0', fontSize: 15, minHeight: 48 },
  byline: { fontSize: 11, color: 'var(--gm-ink-soft)', textAlign: 'center', marginTop: 10 },
  doneTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 20, fontWeight: 600, color: 'var(--gm-forest)', marginBottom: 8 },
  doneText: { fontSize: 14, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 18 },
  error: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 12 },
  empty: { fontSize: 14, color: 'var(--gm-ink-soft)' },
  statRow: { display: 'flex', gap: 8, marginBottom: 14 },
  stat: { flex: 1, background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '12px 8px', textAlign: 'center' },
  statValue: { fontFamily: 'var(--gm-font-display)', fontSize: 20, fontWeight: 600, color: 'var(--gm-forest-dark)' },
  statLabel: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 2 },
  refCard: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: 14, marginBottom: 8 },
  refTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  refPet: { fontSize: 16, fontWeight: 600 },
  refClient: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 1 },
  refMeta: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 8 },
  status: { fontSize: 11, padding: '4px 10px', borderRadius: 999, fontWeight: 500, flexShrink: 0 },
  statusGood: { background: '#E3E9E1', color: 'var(--gm-forest)' },
  statusPending: { background: 'var(--gm-honey-soft)', color: '#7A5A22' },
  statusOff: { background: 'var(--gm-line-soft)', color: 'var(--gm-ink-soft)' },
};
