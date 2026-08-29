import { useState, useEffect } from 'react';
import { fetchPricing } from '../settings/settingsApi.js';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/**
 * How the pet will be carried, and how the family wants the visit paced.
 *
 * The public form only asks whether someone can help — no prices, because
 * presenting a grieving family with a menu of surcharges is the wrong
 * moment. When they answer no, admin talks it through on the phone and
 * records the outcome here, which is where the money is decided.
 */
export default function HandlingFields({ value, onChange, disabled }) {
  const [pricing, setPricing] = useState(null);

  useEffect(() => {
    fetchPricing().then(setPricing).catch(() => setPricing(null));
  }, []);

  const transferFee = pricing?.transferFee?.clientPrice;
  const assistantFee = pricing?.assistantFee?.clientPrice;
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });

  return (
    <>
      <label style={styles.field}>
        <span style={styles.label}>Carrying the pet</span>
        <select value={value.handlingHelp || 'not_needed'} onChange={set('handlingHelp')} disabled={disabled} style={styles.input}>
          <option value="not_needed">Small pet — no help needed</option>
          <option value="client_helps">Someone at home will help</option>
          <option value="assistant">We send a second person</option>
          <option value="direct_pickup">Cremation partner collects directly</option>
          <option value="needs_help">Nobody can help — not resolved yet</option>
        </select>
      </label>

      {/* The money consequence, stated where the choice is made. Both
          options change what the client pays, in opposite directions. */}
      {value.handlingHelp === 'assistant' && (
        <p style={styles.feeNote}>
          Adds {assistantFee != null ? money(assistantFee) : 'the assistant fee'} to the bill.
        </p>
      )}
      {value.handlingHelp === 'direct_pickup' && (
        <p style={styles.feeNote}>
          Removes our {transferFee != null ? money(transferFee) : 'transfer'} fee — the partner
          bills the client directly for collection.
        </p>
      )}
      {value.handlingHelp === 'needs_help' && (
        <p style={styles.warnNote}>
          This job won&apos;t be offered to vets until it&apos;s resolved. Agree a second person
          or a direct pickup with the client first.
        </p>
      )}

      <label style={styles.field}>
        <span style={styles.label}>Pace of the visit</span>
        <select value={value.pace || 'normal'} onChange={set('pace')} disabled={disabled} style={styles.input}>
          <option value="slow">Slow and unhurried</option>
          <option value="normal">Normal</option>
          <option value="quick">Keep it brief</option>
        </select>
      </label>

      <label style={styles.field}>
        <span style={styles.label}>Anything the vet should know about access or handling</span>
        <input
          value={value.handlingNotes || ''}
          onChange={set('handlingNotes')}
          disabled={disabled}
          placeholder="e.g. narrow stairs, no parking out front, nervous dog"
          style={styles.input}
        />
      </label>
    </>
  );
}

const styles = {
  field: { display: 'block', marginBottom: 10 },
  label: { display: 'block', fontSize: 11, color: 'var(--gm-ink-soft)', marginBottom: 3 },
  input: { width: '100%', padding: '9px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, fontFamily: 'inherit', background: '#fff' },
  feeNote: { fontSize: 12, color: 'var(--gm-forest)', marginTop: -6, marginBottom: 10 },
  warnNote: { fontSize: 12, color: '#7A5A22', background: 'var(--gm-honey-soft)', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', marginTop: -4, marginBottom: 10, lineHeight: 1.5 },
};
