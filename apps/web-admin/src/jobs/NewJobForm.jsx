import { useState } from 'react';
import { useNavigate } from 'react-router';
import AppShell from '../layout/AppShell.jsx';
import AddressAutocomplete from '../maps/AddressAutocomplete.jsx';
import { apiFetch } from '../api.js';

const SERVICE_TYPES = [
  { value: 'euthanasia_only', label: 'Euthanasia only' },
  { value: 'private_cremation', label: 'Euthanasia + private cremation' },
  { value: 'communal_cremation', label: 'Euthanasia + communal cremation' },
];

export default function NewJobForm() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [form, setForm] = useState({
    clientName: '', clientPhone: '', clientEmail: '',
    address: '', suburb: '', postcode: '', state: 'VIC', lat: null, lng: null,
    petName: '', petType: '', petBreed: '', petWeight: '', petAge: '', petBehaviour: 'Friendly',
    serviceType: 'euthanasia_only',
    date: '', time: '',
    isPublicHoliday: false,
    notes: '',
  });

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // Typed text always populates the address field, whether or not a
  // Places suggestion is ever picked. Previously address was only set by
  // onAddressSelect, so if autocomplete produced no suggestions (invalid
  // API key, offline, or an address Google doesn't know) the user could
  // type a full address and still hit "address: must contain at least 1
  // character" on submit, with no way through.
  const onAddressTextChange = (text) => {
    setAddressInput(text);
    // Clear any previously-selected coordinates — they belonged to a
    // different address and would otherwise be dispatched against.
    setForm((f) => ({ ...f, address: text, lat: null, lng: null }));
  };

  const onAddressSelect = ({ formattedAddress, lat, lng }) => {
    setAddressInput(formattedAddress);
    setForm((f) => ({ ...f, address: formattedAddress, lat, lng }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await apiFetch('/jobs', { method: 'POST', body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create booking');
      navigate(`/jobs/${data.job.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>New booking</h1>
        <form onSubmit={onSubmit} style={styles.form}>
          {error && <p style={styles.error}>{error}</p>}

          <Section title="Client">
            <Row>
              <Field label="Full name" required><input value={form.clientName} onChange={set('clientName')} required style={styles.input} /></Field>
              <Field label="Phone" required><input value={form.clientPhone} onChange={set('clientPhone')} required style={styles.input} /></Field>
            </Row>
            <Field label="Email"><input type="email" value={form.clientEmail} onChange={set('clientEmail')} style={styles.input} /></Field>
          </Section>

          <Section title="Address">
            <Field label="Search address" required>
              <AddressAutocomplete value={addressInput} onChange={onAddressTextChange} onSelect={onAddressSelect} />
            </Field>
            <Row>
              <Field label="Suburb"><input value={form.suburb} onChange={set('suburb')} style={styles.input} /></Field>
              <Field label="Postcode" required><input value={form.postcode} onChange={set('postcode')} required style={styles.input} /></Field>
              <Field label="State" required>
                <select value={form.state} onChange={set('state')} style={styles.input}>
                  {['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
            </Row>
          </Section>

          <Section title="Pet">
            <Row>
              <Field label="Name" required><input value={form.petName} onChange={set('petName')} required style={styles.input} /></Field>
              <Field label="Type" required><input value={form.petType} onChange={set('petType')} placeholder="Dog, cat…" required style={styles.input} /></Field>
              <Field label="Breed"><input value={form.petBreed} onChange={set('petBreed')} style={styles.input} /></Field>
            </Row>
            <Row>
              <Field label="Weight"><input value={form.petWeight} onChange={set('petWeight')} style={styles.input} /></Field>
              <Field label="Age"><input value={form.petAge} onChange={set('petAge')} style={styles.input} /></Field>
              <Field label="Temperament">
                <select value={form.petBehaviour} onChange={set('petBehaviour')} style={styles.input}>
                  <option>Friendly</option>
                  <option>Nervous</option>
                  <option>Can be snappy</option>
                  <option>Needs sedation first</option>
                </select>
              </Field>
            </Row>
          </Section>

          <Section title="Service & schedule">
            <Field label="Service" required>
              <select value={form.serviceType} onChange={set('serviceType')} style={styles.input}>
                {SERVICE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Row>
              <Field label="Date" required><input type="date" value={form.date} onChange={set('date')} required style={styles.input} /></Field>
              <Field label="Time" required><input type="time" value={form.time} onChange={set('time')} required style={styles.input} /></Field>
            </Row>
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={form.isPublicHoliday}
                onChange={(e) => setForm((f) => ({ ...f, isPublicHoliday: e.target.checked }))}
              />
              <span>This visit falls on a public holiday (adds the public holiday surcharge)</span>
            </label>
          </Section>

          <Section title="Notes">
            <textarea value={form.notes} onChange={set('notes')} rows={3} style={{ ...styles.input, resize: 'vertical' }} placeholder="Gate code, parking, anything the vet should know before arriving…" />
          </Section>

          <div style={styles.actions}>
            <button type="submit" disabled={saving} style={styles.submitBtn}>{saving ? 'Creating…' : 'Create booking'}</button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginBottom: 10, fontFamily: 'var(--gm-font-body)', fontWeight: 600 }}>{title}</h3>
      {children}
    </div>
  );
}
function Row({ children }) {
  return <div style={{ display: 'flex', gap: 12 }}>{children}</div>;
}
function Field({ label, required, children }) {
  return (
    <label style={{ display: 'block', flex: 1, fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 12 }}>
      {label}{required && ' *'}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}

const styles = {
  page: { padding: '32px 40px', maxWidth: 640 },
  title: { fontSize: 24, marginBottom: 20 },
  form: {},
  input: { width: '100%', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, background: '#fff' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 4 },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 16 },
  actions: { marginTop: 8 },
  submitBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '11px 22px', borderRadius: 'var(--gm-radius-sm)', fontSize: 14, fontWeight: 500 },
};
