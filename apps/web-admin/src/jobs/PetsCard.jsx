import { useState, useEffect, useCallback } from 'react';
import { fetchPets, addPet, removePet } from './jobsApi.js';

const SERVICES = [
  { value: 'euthanasia_only', label: 'Euthanasia only' },
  { value: 'private_cremation', label: 'Private cremation' },
  { value: 'communal_cremation', label: 'Communal cremation' },
];

/**
 * Pets on a booking.
 *
 * A family may say goodbye to two or three animals in one visit. Each
 * pet needs its OWN signed consent — consent is a decision about a
 * specific animal, and one signature covering "the pets" isn't a record
 * worth relying on if it's ever questioned.
 */
export default function PetsCard({ jobId, onChanged }) {
  const [pets, setPets] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', species: '', breed: '', weight: '', age: '', serviceType: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchPets(jobId).then(setPets).catch(() => setPets([]));
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) { setError('The pet needs a name.'); return; }
    setBusy(true);
    setError('');
    try {
      await addPet(jobId, { ...form, serviceType: form.serviceType || null });
      setForm({ name: '', species: '', breed: '', weight: '', age: '', serviceType: '' });
      setAdding(false);
      load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (pet) => {
    if (!window.confirm(`Remove ${pet.name} from this booking?`)) return;
    try {
      await removePet(jobId, pet.id);
      load();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  const outstanding = (pets || []).filter((p) => !p.consent_signed).length;

  // Flag the heavy ones explicitly. The weight was printed in a run of
  // "Dog · Labrador · 12 years · 45kg" and read past — nothing told
  // admin this booking needs a conversation before a vet is offered it.
  const heavy = (pets || []).filter((p) => {
    const kg = Number(String(p.weight || '').replace(/[^\d.]/g, ''));
    return Number.isFinite(kg) && kg >= 30;
  });
  const noWeight = (pets || []).filter((p) => !String(p.weight || '').match(/\d/));

  return (
    <>
      {error && <p style={styles.error}>{error}</p>}

      {pets === null ? (
        <p style={styles.hint}>Loading…</p>
      ) : (
        pets.map((p, i) => (
          <div key={p.id} style={styles.row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.name}>
                {p.name}
                {i === 0 && <span style={styles.primary}> · main</span>}
              </div>
              <div style={styles.meta}>
                {[p.species, p.breed, p.age, p.weight].filter(Boolean).join(' · ') || '—'}
              </div>
              <div style={styles.meta}>
                {SERVICES.find((s) => s.value === p.service_type)?.label || 'Service not set'}
              </div>
              <div style={p.consent_signed ? styles.signed : styles.unsigned}>
                {p.consent_signed
                  ? `Consent signed${p.consent_signature_name ? ` by ${p.consent_signature_name}` : ''}`
                  : 'Consent not signed yet'}
              </div>
            </div>
            {/* Only offer removal where it's allowed. The server refuses
                to drop a signed pet or the last one; showing a button
                that always errors would be worse than hiding it. */}
            {!p.consent_signed && pets.length > 1 && (
              <button onClick={() => remove(p)} style={styles.remove}>Remove</button>
            )}
          </div>
        ))
      )}

      {/* Above the pet list, because it changes what happens next. */}
      {heavy.length > 0 && (
        <p style={styles.heavyWarn}>
          <strong>{heavy.map((p) => `${p.name} (${p.weight})`).join(', ')}</strong>
          {heavy.length === 1 ? ' is' : ' are'} over 30kg. This job won&apos;t be offered
          automatically — a vet needs to know what they&apos;re taking on. Confirm who&apos;s
          carrying before assigning.
        </p>
      )}
      {pets && noWeight.length > 0 && (
        <p style={styles.heavyWarn}>
          No weight recorded for <strong>{noWeight.map((p) => p.name).join(', ')}</strong>.
          The job stays on manual assignment until it&apos;s known.
        </p>
      )}

      {pets && pets.length > 1 && (
        <p style={styles.multiNote}>
          {outstanding === 0
            ? 'All consent forms signed.'
            : `${outstanding} consent form${outstanding === 1 ? '' : 's'} still to sign — the client signs one per pet.`}
          {' '}Remember to add a charge for the additional pet; pricing is per booking, not per animal.
        </p>
      )}

      {!adding ? (
        <button onClick={() => setAdding(true)} style={styles.addBtn}>+ Add another pet</button>
      ) : (
        <div style={styles.form}>
          <div style={styles.formRow}>
            <Field label="Name"><input value={form.name} onChange={set('name')} autoFocus style={styles.input} /></Field>
            <Field label="Type"><input value={form.species} onChange={set('species')} placeholder="Dog" style={styles.input} /></Field>
          </div>
          <div style={styles.formRow}>
            <Field label="Breed"><input value={form.breed} onChange={set('breed')} style={styles.input} /></Field>
            <Field label="Age"><input value={form.age} onChange={set('age')} style={styles.input} /></Field>
            <Field label="Weight"><input value={form.weight} onChange={set('weight')} style={styles.input} /></Field>
          </div>
          <Field label="Service for this pet">
            <select value={form.serviceType} onChange={set('serviceType')} style={styles.input}>
              <option value="">Same as the booking</option>
              {SERVICES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <p style={styles.hint}>
            A family can choose differently for each animal — private cremation for one and
            communal for another.
          </p>
          <div style={styles.actions}>
            <button onClick={() => { setAdding(false); setError(''); }} style={styles.cancelBtn}>Cancel</button>
            <button onClick={save} disabled={busy} style={styles.saveBtn}>
              {busy ? 'Adding…' : 'Add pet'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      {children}
    </label>
  );
}

const styles = {
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', lineHeight: 1.5, marginBottom: 10 },
  error: { fontSize: 12, color: 'var(--gm-brick)', marginBottom: 10 },
  row: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--gm-line-soft)' },
  name: { fontSize: 14, fontWeight: 600 },
  primary: { fontSize: 11, color: 'var(--gm-ink-soft)', fontWeight: 400 },
  meta: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  signed: { fontSize: 11, color: 'var(--gm-forest)', marginTop: 3, fontWeight: 500 },
  unsigned: { fontSize: 11, color: '#7A5A22', marginTop: 3, fontWeight: 500 },
  remove: { background: 'none', border: 'none', color: 'var(--gm-brick)', fontSize: 12, textDecoration: 'underline', flexShrink: 0 },
  heavyWarn: { fontSize: 12, lineHeight: 1.6, color: 'var(--gm-brick)', background: '#F5E3E0', padding: '10px 12px', borderRadius: 'var(--gm-radius-sm)', marginBottom: 10 },
  multiNote: { fontSize: 12, color: '#7A5A22', background: 'var(--gm-honey-soft)', padding: '9px 11px', borderRadius: 'var(--gm-radius-sm)', marginTop: 10, lineHeight: 1.5 },
  addBtn: { width: '100%', marginTop: 12, background: '#fff', color: 'var(--gm-forest)', border: '1px solid var(--gm-forest)', borderRadius: 'var(--gm-radius-sm)', padding: '9px', fontSize: 13, fontWeight: 500 },
  form: { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--gm-line)' },
  formRow: { display: 'flex', gap: 8 },
  field: { display: 'block', flex: 1, minWidth: 0, marginBottom: 10 },
  label: { display: 'block', fontSize: 11, color: 'var(--gm-ink-soft)', marginBottom: 3 },
  input: { width: '100%', padding: '9px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, fontFamily: 'inherit', background: '#fff' },
  actions: { display: 'flex', gap: 8 },
  cancelBtn: { flex: 1, background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '10px 0', fontSize: 13 },
  saveBtn: { flex: 1, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '10px 0', fontSize: 13, fontWeight: 500 },
};
