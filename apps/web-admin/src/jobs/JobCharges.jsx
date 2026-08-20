import { useEffect, useState } from 'react';
import { fetchLineItems, addLineItem, removeLineItem } from './jobsApi.js';

// Common extras, offered as one-tap presets so admin isn't retyping
// "Large pet handling" on every second job. Amounts are starting points
// — the field stays editable because real jobs vary.
const PRESETS = [
  { label: 'Extra travel', amount: 40, vetPayout: 40 },
  { label: 'Large pet handling', amount: 60, vetPayout: 40 },
  { label: 'Extra time on site', amount: 45, vetPayout: 45 },
  { label: 'Aggressive patient / sedation', amount: 55, vetPayout: 40 },
];

export default function JobCharges({ jobId, onChanged }) {
  const [items, setItems] = useState(null);
  const [mode, setMode] = useState(null); // null | 'charge' | 'discount'
  const [form, setForm] = useState({ label: '', amount: '', vetPayout: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => fetchLineItems(jobId).then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, [jobId]);

  const openCharge = (preset) => {
    setMode('charge');
    setError('');
    setForm(preset
      ? { label: preset.label, amount: String(preset.amount), vetPayout: String(preset.vetPayout) }
      : { label: '', amount: '', vetPayout: '' });
  };

  const openDiscount = () => {
    setMode('discount');
    setError('');
    setForm({ label: '', amount: '', vetPayout: '' });
  };

  // When adding a custom charge, default the vet's share to the FULL
  // amount as soon as an amount is typed. Leaving it blank meant zero,
  // so an admin adding "Extra travel $40" by hand charged the client but
  // paid the vet nothing — silently, with nothing on screen to suggest
  // it. Zero is still allowed, it just has to be chosen deliberately.
  const onAmountChange = (value) => {
    setForm((f) => ({
      ...f,
      amount: value,
      vetPayout: f.vetPayoutTouched ? f.vetPayout : value,
    }));
  };

  const submit = async () => {
    const magnitude = Number(form.amount);
    if (!form.label.trim() || !magnitude || magnitude <= 0) {
      setError('Enter a label and an amount greater than zero.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await addLineItem(jobId, {
        label: form.label.trim(),
        // The user always types a positive number; the sign is decided by
        // which button they pressed, so a discount can't be entered as a
        // charge by forgetting a minus sign.
        amount: mode === 'discount' ? -magnitude : magnitude,
        vetPayout: mode === 'discount' ? 0 : Number(form.vetPayout) || 0,
      });
      setMode(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (itemId) => {
    setBusy(true);
    try {
      await removeLineItem(jobId, itemId);
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {items === null ? (
        <p style={styles.hint}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={styles.hint}>No extra charges or discounts on this job.</p>
      ) : (
        <div style={styles.list}>
          {items.map((it) => {
            const amt = Number(it.amount);
            const isDiscount = amt < 0;
            return (
              <div key={it.id} style={styles.row}>
                <span style={styles.rowLabel}>{it.label}</span>
                <span style={{ ...styles.rowAmount, color: isDiscount ? 'var(--gm-forest)' : 'var(--gm-ink)' }}>
                  {isDiscount ? '−' : '+'}${Math.abs(amt).toFixed(2)}
                </span>
                {Number(it.vet_payout) > 0 && (
                  <span style={styles.payoutTag}>vet ${Number(it.vet_payout).toFixed(2)}</span>
                )}
                <button onClick={() => remove(it.id)} disabled={busy} style={styles.removeBtn}>×</button>
              </div>
            );
          })}
        </div>
      )}

      {mode === null ? (
        <>
          <div style={styles.presetRow}>
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => openCharge(p)} style={styles.presetBtn}>
                + {p.label}
              </button>
            ))}
          </div>
          <div style={styles.actionRow}>
            <button onClick={() => openCharge(null)} style={styles.addBtn}>+ Other charge</button>
            <button onClick={openDiscount} style={styles.discountBtn}>− Discount</button>
          </div>
        </>
      ) : (
        <div style={styles.form}>
          {error && <p style={styles.error}>{error}</p>}
          <input
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            placeholder={mode === 'discount' ? 'Reason for discount' : 'What is the charge for?'}
            style={styles.input}
          />
          <div style={styles.formRow}>
            <label style={styles.fieldLabel}>
              {mode === 'discount' ? 'Discount amount' : 'Client pays'}
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => onAmountChange(e.target.value)}
                style={styles.input}
              />
            </label>
            {mode === 'charge' && (
              <label style={styles.fieldLabel}>
                Vet is paid
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.vetPayout}
                  onChange={(e) => setForm((f) => ({ ...f, vetPayout: e.target.value, vetPayoutTouched: true }))}
                  style={styles.input}
                />
              </label>
            )}
          </div>
          {mode === 'discount' ? (
            <p style={styles.hint}>Discounts reduce what the client pays. The vet's payout is unaffected.</p>
          ) : (
            <p style={styles.hint}>
              {Number(form.vetPayout) > 0
                ? `Client pays $${Number(form.amount || 0).toFixed(2)} · vet receives $${Number(form.vetPayout || 0).toFixed(2)}`
                : 'Vet receives nothing from this charge — set an amount above if they should be paid.'}
            </p>
          )}
          <div style={styles.formActions}>
            <button onClick={() => setMode(null)} style={styles.cancelBtn}>Cancel</button>
            <button onClick={submit} disabled={busy} style={styles.saveBtn}>
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', fontStyle: 'italic', margin: '0 0 10px' },
  list: { marginBottom: 12 },
  row: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--gm-line-soft)', fontSize: 13 },
  rowLabel: { flex: 1, minWidth: 0 },
  rowAmount: { fontWeight: 600, flexShrink: 0 },
  payoutTag: { fontSize: 10, color: 'var(--gm-ink-soft)', background: 'var(--gm-line-soft)', borderRadius: 4, padding: '2px 5px', flexShrink: 0 },
  removeBtn: { background: 'none', border: 'none', color: 'var(--gm-brick)', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0 },
  presetRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  presetBtn: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '5px 10px', fontSize: 11, fontWeight: 500 },
  actionRow: { display: 'flex', gap: 8 },
  addBtn: { flex: 1, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '8px 0', fontSize: 12, fontWeight: 500 },
  discountBtn: { flex: 1, background: '#fff', color: 'var(--gm-forest)', border: '1px solid var(--gm-forest)', borderRadius: 'var(--gm-radius-sm)', padding: '8px 0', fontSize: 12, fontWeight: 500 },
  form: { marginTop: 4 },
  formRow: { display: 'flex', gap: 10 },
  fieldLabel: { flex: 1, fontSize: 11, color: 'var(--gm-ink-soft)' },
  input: { width: '100%', padding: '8px 10px', marginTop: 4, marginBottom: 8, borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 13, background: '#fff' },
  formActions: { display: 'flex', gap: 8, marginTop: 4 },
  cancelBtn: { flex: 1, background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '8px 0', fontSize: 12, fontWeight: 500 },
  saveBtn: { flex: 1, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '8px 0', fontSize: 12, fontWeight: 500 },
  error: { fontSize: 12, color: 'var(--gm-brick)', marginBottom: 8 },
};
