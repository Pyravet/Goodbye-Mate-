import { useState, useEffect } from 'react';
import {
  fetchExtraServices, createExtraService, updateExtraService, retireExtraService,
} from './settingsApi.js';

/**
 * Reusable, priced add-on services — a home-visit fee, a keepsake, a
 * certificate — that admin can apply to a job in one click instead of
 * typing the label, charge and vet payout by hand every time.
 *
 * This is a CATALOG, not a charge. Adding one here changes nothing on
 * any job; it only makes the option available when billing one. Editing
 * a service's price here has no effect on jobs it was already applied
 * to — each application copies the numbers onto the job at that moment,
 * the same as every other price in this app.
 */
export default function ExtraServicesCard() {
  const [services, setServices] = useState(null);
  const [form, setForm] = useState({ name: '', clientPrice: '', vetPayout: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => fetchExtraServices().then(setServices).catch(() => setServices([]));
  useEffect(() => { load(); }, []);

  const add = async () => {
    const clientPrice = Number(form.clientPrice);
    const vetPayout = Number(form.vetPayout || 0);
    if (!form.name.trim()) return setError('Give the service a name.');
    if (!Number.isFinite(clientPrice) || clientPrice < 0) return setError('Client price must be 0 or more.');
    if (!Number.isFinite(vetPayout) || vetPayout < 0) return setError('Vet payout must be 0 or more.');

    setBusy(true);
    setError('');
    try {
      await createExtraService({ name: form.name.trim(), clientPrice, vetPayout });
      setForm({ name: '', clientPrice: '', vetPayout: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async (svc, patch) => {
    try {
      await updateExtraService(svc.id, patch);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const retire = async (svc) => {
    if (!window.confirm(
      `Retire "${svc.name}"? It stays on any job already using it, but won't be offered for new charges.`
    )) return;
    try {
      await retireExtraService(svc.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <p style={styles.hint}>
        Add-on services with a set price — a keepsake, a certificate, a home-visit fee. Once
        added, pick one from a job&apos;s billing to charge it without retyping the amount.
        Retiring a service removes it from that picker; jobs that already used it are
        unaffected.
      </p>

      {error && <p style={styles.error}>{error}</p>}

      {services === null ? (
        <p style={styles.hint}>Loading…</p>
      ) : services.length === 0 ? (
        <p style={styles.hint}>No extra services yet.</p>
      ) : (
        services.map((svc) => (
          <div key={svc.id} style={styles.row}>
            <input
              defaultValue={svc.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== svc.name && save(svc, { name: e.target.value.trim() })}
              style={{ ...styles.input, flex: 2 }}
            />
            <Field label="Client pays">
              <input
                type="number" defaultValue={svc.clientPrice}
                onBlur={(e) => Number(e.target.value) !== svc.clientPrice && save(svc, { clientPrice: Number(e.target.value) })}
                style={styles.numInput}
              />
            </Field>
            <Field label="Vet payout">
              <input
                type="number" defaultValue={svc.vetPayout}
                onBlur={(e) => Number(e.target.value) !== svc.vetPayout && save(svc, { vetPayout: Number(e.target.value) })}
                style={styles.numInput}
              />
            </Field>
            <button onClick={() => retire(svc)} style={styles.retireBtn}>Retire</button>
          </div>
        ))
      )}

      <div style={styles.addRow}>
        <input
          placeholder="Service name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          style={{ ...styles.input, flex: 2 }}
        />
        <Field label="Client pays">
          <input
            type="number" placeholder="0"
            value={form.clientPrice}
            onChange={(e) => setForm((f) => ({ ...f, clientPrice: e.target.value }))}
            style={styles.numInput}
          />
        </Field>
        <Field label="Vet payout">
          <input
            type="number" placeholder="0"
            value={form.vetPayout}
            onChange={(e) => setForm((f) => ({ ...f, vetPayout: e.target.value }))}
            style={styles.numInput}
          />
        </Field>
        <button onClick={add} disabled={busy} style={styles.addBtn}>
          {busy ? 'Adding…' : '+ Add service'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

const styles = {
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 12 },
  error: { fontSize: 12, color: 'var(--gm-brick)', marginBottom: 10 },
  row: { display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 10 },
  addRow: { display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 4, paddingTop: 10, borderTop: '1px dashed var(--gm-line)' },
  field: { display: 'flex', flexDirection: 'column', gap: 2 },
  fieldLabel: { fontSize: 10, color: 'var(--gm-ink-soft)' },
  input: { minHeight: 40, padding: '0 10px', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', fontSize: 13 },
  numInput: { width: 80, minHeight: 40, padding: '0 10px', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', fontSize: 13 },
  retireBtn: { minHeight: 40, padding: '0 12px', background: '#fff', border: '1px solid var(--gm-brick)', color: 'var(--gm-brick)', borderRadius: 'var(--gm-radius-sm)', fontSize: 12, cursor: 'pointer' },
  addBtn: { minHeight: 40, padding: '0 16px', background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
};
