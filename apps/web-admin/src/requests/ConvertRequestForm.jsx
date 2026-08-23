import { useState } from 'react';
import DuplicateWarning from '../jobs/DuplicateWarning.jsx';
import { useNavigate } from 'react-router';
import { convertRequest } from './requestsApi.js';

const SERVICE_OPTIONS = [
  { value: 'euthanasia_only', label: 'Euthanasia only' },
  { value: 'private_cremation', label: 'Private cremation (ashes returned)' },
  { value: 'communal_cremation', label: 'Communal cremation' },
];

const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

/**
 * Map the client's free-text service choice onto a real service type.
 * Returns '' when it can't be determined, so admin picks rather than the
 * form guessing — the wrong choice changes both price and whether ashes
 * come back.
 */
function guessService(preference) {
  const p = (preference || '').toLowerCase();
  if (p.includes('private')) return 'private_cremation';
  if (p.includes('communal')) return 'communal_cremation';
  if (p.includes('euthanasia only')) return 'euthanasia_only';
  return '';
}

/**
 * Confirm-and-dispatch screen for a booking request.
 *
 * Pre-filled from what the client submitted so nothing is re-keyed, but
 * the fields that dispatch and pricing actually depend on — address,
 * postcode, service type, date and time — must be confirmed by a human.
 * A public request has an unverified address and often no firm service
 * type, and offering that straight to vets would mean offering a job
 * whose location and payout aren't really known.
 */
export default function ConvertRequestForm({ request, onCancel, onDone }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    address: request.address || '',
    suburb: request.suburb || '',
    postcode: request.postcode || '',
    state: request.state || 'NSW',
    petName: request.pet_name || '',
    petType: request.pet_type || '',
    petBreed: request.pet_breed || '',
    petWeight: request.pet_weight || '',
    petAge: request.pet_age || '',
    serviceType: guessService(request.service_preference),
    date: '',
    time: '',
    notes: '',
    dispatch: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await convertRequest(request.id, form);
      onDone?.();
      navigate(`/jobs/${result.job.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={styles.wrap}>
      <div style={styles.head}>
        <strong>Create booking for {request.client_name}</strong>
        <button type="button" onClick={onCancel} style={styles.close}>Cancel</button>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      {/* The client's own words, kept visible while admin fills the form
          in — it's usually where the real timing constraint is. */}
      {(request.preferred_timing || request.message) && (
        <div style={styles.quote}>
          {request.preferred_timing && <div><strong>Wants:</strong> {request.preferred_timing}</div>}
          {request.message && <div style={{ marginTop: 4 }}>{request.message}</div>}
        </div>
      )}

      {/* This is the likeliest source of duplicates: a distressed
          person rings the office AND submits the web form. */}
      <DuplicateWarning
        clientName={request.client_name}
        clientPhone={request.client_phone}
        clientEmail={request.client_email}
        petName={form.petName}
        date={form.date}
      />

      <Field label="Address" required>
        <input value={form.address} onChange={set('address')} required style={styles.input} />
      </Field>
      <div style={styles.row}>
        <Field label="Suburb" flex>
          <input value={form.suburb} onChange={set('suburb')} style={styles.input} />
        </Field>
        <Field label="Postcode" required flex>
          <input value={form.postcode} onChange={set('postcode')} required style={styles.input} />
        </Field>
        <Field label="State" flex>
          <select value={form.state} onChange={set('state')} style={styles.input}>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <p style={styles.hint}>
        The postcode decides which vets are offered this job, so it needs to be right.
      </p>

      <div style={styles.row}>
        <Field label="Pet name" required flex>
          <input value={form.petName} onChange={set('petName')} required style={styles.input} />
        </Field>
        <Field label="Type" required flex>
          <input value={form.petType} onChange={set('petType')} required placeholder="Dog / Cat" style={styles.input} />
        </Field>
      </div>
      <div style={styles.row}>
        <Field label="Breed" flex>
          <input value={form.petBreed} onChange={set('petBreed')} style={styles.input} />
        </Field>
        <Field label="Weight" flex>
          <input value={form.petWeight} onChange={set('petWeight')} placeholder="e.g. 31 kg" style={styles.input} />
        </Field>
        <Field label="Age" flex>
          <input value={form.petAge} onChange={set('petAge')} style={styles.input} />
        </Field>
      </div>

      <Field label="Service" required>
        <select value={form.serviceType} onChange={set('serviceType')} required style={styles.input}>
          <option value="">Choose…</option>
          {SERVICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      {!guessService(request.service_preference) && request.service_preference && (
        <p style={styles.hint}>
          Client said “{request.service_preference}” — confirm on the phone before booking.
        </p>
      )}

      <div style={styles.row}>
        <Field label="Date" required flex>
          <input type="date" value={form.date} onChange={set('date')} required style={styles.input} />
        </Field>
        <Field label="Time" required flex>
          <input type="time" value={form.time} onChange={set('time')} required style={styles.input} />
        </Field>
      </div>

      <Field label="Notes for the job (optional)">
        <textarea value={form.notes} onChange={set('notes')} rows={2} style={styles.input} />
      </Field>

      <label style={styles.checkRow}>
        <input type="checkbox" checked={form.dispatch} onChange={set('dispatch')} />
        <span>
          Offer to vets straight away
          <br />
          <span style={styles.hint}>
            Untick to create the booking without dispatching — useful if the client is still
            settling on a time.
          </span>
        </span>
      </label>

      <button type="submit" disabled={busy} style={styles.submit}>
        {busy
          ? 'Creating…'
          : form.dispatch ? 'Create booking & offer to vets' : 'Create booking'}
      </button>
    </form>
  );
}

function Field({ label, required, children, flex }) {
  return (
    <label style={{ ...styles.field, ...(flex ? { flex: 1, minWidth: 0 } : {}) }}>
      <span style={styles.label}>{label}{required && <span style={styles.req}> *</span>}</span>
      {children}
    </label>
  );
}

const styles = {
  wrap: { borderTop: '1px solid var(--gm-line)', marginTop: 12, paddingTop: 14 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, fontSize: 14 },
  close: { background: 'none', border: 'none', color: 'var(--gm-ink-soft)', fontSize: 12, textDecoration: 'underline' },
  quote: { background: 'var(--gm-line-soft)', borderRadius: 'var(--gm-radius-sm)', padding: '10px 12px', fontSize: 13, marginBottom: 14, lineHeight: 1.5 },
  field: { display: 'block', marginBottom: 10 },
  label: { display: 'block', fontSize: 11, color: 'var(--gm-ink-soft)', marginBottom: 3 },
  req: { color: 'var(--gm-brick)' },
  input: { width: '100%', padding: '9px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, fontFamily: 'inherit', background: '#fff' },
  row: { display: 'flex', gap: 8 },
  hint: { fontSize: 11, color: 'var(--gm-ink-soft)', fontStyle: 'italic', marginTop: -4, marginBottom: 10, lineHeight: 1.4 },
  checkRow: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, margin: '10px 0 14px' },
  submit: { width: '100%', background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '11px 0', fontSize: 14, fontWeight: 500 },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 10 },
};
