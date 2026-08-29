import { useState } from 'react';
import HandlingFields from './HandlingFields.jsx';
import { updateJob } from './jobsApi.js';

const SERVICES = [
  { value: 'euthanasia_only', label: 'Euthanasia only' },
  { value: 'private_cremation', label: 'Private cremation' },
  { value: 'communal_cremation', label: 'Communal cremation' },
];

/**
 * Amend an existing booking.
 *
 * Bookings used to be immutable, so a wrong address or a client moving
 * the time meant cancelling and re-keying — which loses the job's
 * history, its signed consent and its payment.
 *
 * Changing date or time is called out explicitly, because it withdraws
 * live offers and notifies an assigned vet: they agreed to a specific
 * slot, and silently moving a job under them is how someone ends up at
 * the wrong door.
 */
export default function EditJobForm({ job, onCancel, onSaved }) {
  const [form, setForm] = useState({
    clientName: job.client_name || '',
    clientPhone: job.client_phone || '',
    clientEmail: job.client_email || '',
    address: job.address || '',
    suburb: job.suburb || '',
    postcode: job.postcode || '',
    state: job.state || 'NSW',
    petName: job.pet_name || '',
    petType: job.pet_type || '',
    petBreed: job.pet_breed || '',
    petWeight: job.pet_weight || '',
    petAge: job.pet_age || '',
    serviceType: job.service_type || 'euthanasia_only',
    date: String(job.job_date || '').slice(0, 10),
    time: String(job.job_time || '').slice(0, 5),
    timeEnd: String(job.job_time_end || '').slice(0, 5),
    notes: job.notes || '',
    handlingHelp: job.handling_help || 'not_needed',
    pace: job.pace || 'normal',
    handlingNotes: job.handling_notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const timeChanged =
    form.date !== String(job.job_date || '').slice(0, 10)
    || form.time !== String(job.job_time || '').slice(0, 5);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await updateJob(job.id, form);
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} style={styles.wrap}>
      {error && <p style={styles.error}>{error}</p>}

      <Field label="Client name"><input value={form.clientName} onChange={set('clientName')} style={styles.input} /></Field>
      <div style={styles.row}>
        <Field label="Phone" flex><input value={form.clientPhone} onChange={set('clientPhone')} style={styles.input} /></Field>
        <Field label="Email" flex><input type="email" value={form.clientEmail} onChange={set('clientEmail')} style={styles.input} /></Field>
      </div>

      <Field label="Address"><input value={form.address} onChange={set('address')} style={styles.input} /></Field>
      <div style={styles.row}>
        <Field label="Suburb" flex><input value={form.suburb} onChange={set('suburb')} style={styles.input} /></Field>
        <Field label="Postcode" flex><input value={form.postcode} onChange={set('postcode')} style={styles.input} /></Field>
        <Field label="State" flex>
          <select value={form.state} onChange={set('state')} style={styles.input}>
            {['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>

      <div style={styles.row}>
        <Field label="Pet name" flex><input value={form.petName} onChange={set('petName')} style={styles.input} /></Field>
        <Field label="Type" flex><input value={form.petType} onChange={set('petType')} style={styles.input} /></Field>
      </div>
      <div style={styles.row}>
        <Field label="Breed" flex><input value={form.petBreed} onChange={set('petBreed')} style={styles.input} /></Field>
        <Field label="Weight" flex><input value={form.petWeight} onChange={set('petWeight')} style={styles.input} /></Field>
        <Field label="Age" flex><input value={form.petAge} onChange={set('petAge')} style={styles.input} /></Field>
      </div>

      <Field label="Service">
        <select value={form.serviceType} onChange={set('serviceType')} style={styles.input}>
          {SERVICES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Field>

      <div style={styles.row}>
        <Field label="Date" flex><input type="date" value={form.date} onChange={set('date')} style={styles.input} /></Field>
        <Field label="Arrives from" flex><input type="time" value={form.time} onChange={set('time')} style={styles.input} /></Field>
        <Field label="Until (optional)" flex><input type="time" value={form.timeEnd} onChange={set('timeEnd')} style={styles.input} /></Field>
      </div>
      <p style={styles.hint}>
        Leave “Until” blank for a fixed appointment time. Setting it gives the client an arrival
        window instead — usually more honest for an at-home visit, since the previous visit can't
        be rushed.
      </p>

      <HandlingFields value={form} onChange={(v) => setForm((f) => ({ ...f, ...v }))} />

      <Field label="Booking notes (includes the client\u2019s own words)"><textarea value={form.notes} onChange={set('notes')} rows={2} style={styles.input} /></Field>

      {timeChanged && (
        <p style={styles.warn}>
          You've changed the date or time. Any offers waiting on a vet will be withdrawn, and an
          assigned vet will be notified of the new slot.
        </p>
      )}

      <div style={styles.actions}>
        <button type="button" onClick={onCancel} style={styles.cancelBtn}>Cancel</button>
        <button type="submit" disabled={busy} style={styles.saveBtn}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children, flex }) {
  return (
    <label style={{ ...styles.field, ...(flex ? { flex: 1, minWidth: 0 } : {}) }}>
      <span style={styles.label}>{label}</span>
      {children}
    </label>
  );
}

const styles = {
  wrap: { marginTop: 10 },
  field: { display: 'block', marginBottom: 10 },
  label: { display: 'block', fontSize: 11, color: 'var(--gm-ink-soft)', marginBottom: 3 },
  input: { width: '100%', padding: '9px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, fontFamily: 'inherit', background: '#fff' },
  row: { display: 'flex', gap: 8 },
  hint: { fontSize: 11, color: 'var(--gm-ink-soft)', fontStyle: 'italic', marginTop: -4, marginBottom: 10, lineHeight: 1.4 },
  warn: { fontSize: 12, color: '#7A5A22', background: 'var(--gm-honey-soft)', padding: '9px 11px', borderRadius: 'var(--gm-radius-sm)', marginBottom: 10, lineHeight: 1.5 },
  error: { fontSize: 12, color: 'var(--gm-brick)', marginBottom: 10 },
  actions: { display: 'flex', gap: 8 },
  cancelBtn: { flex: 1, background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '10px 0', fontSize: 13, fontWeight: 500 },
  saveBtn: { flex: 1, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '10px 0', fontSize: 13, fontWeight: 500 },
};
