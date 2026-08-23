import { useEffect, useState } from 'react';
import { fetchPricing, savePricing } from './settingsApi.js';

export default function PricingTab() {
  const [pricing, setPricing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchPricing().then(setPricing).catch(() => setPricing(null)).finally(() => setLoading(false));
  }, []);

  const onSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await savePricing(pricing);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const updateService = (index, field, value) => {
    setPricing((p) => {
      const services = [...p.services];
      services[index] = { ...services[index], [field]: field === 'name' || field === 'id' ? value : Number(value) };
      return { ...p, services };
    });
    setSaved(false);
  };

  const updateField = (path, value) => {
    setPricing((p) => {
      const next = { ...p };
      if (path.length === 1) {
        next[path[0]] = Number(value);
      } else {
        next[path[0]] = { ...next[path[0]], [path[1]]: Number(value) };
      }
      return next;
    });
    setSaved(false);
  };

  if (loading) return <p style={{ color: 'var(--gm-ink-soft)', fontSize: 13 }}>Loading…</p>;
  if (!pricing) return <p style={{ color: 'var(--gm-brick)', fontSize: 13 }}>Failed to load pricing settings.</p>;

  return (
    <div>
      <Card title="Services">
        {pricing.services.map((svc, i) => (
          <div key={svc.id} style={styles.serviceRow}>
            <input value={svc.name} onChange={(e) => updateService(i, 'name', e.target.value)} style={{ ...styles.input, flex: 2 }} />
            <FieldInline label="Client pays">
              <input type="number" value={svc.clientPrice} onChange={(e) => updateService(i, 'clientPrice', e.target.value)} style={styles.numInput} />
            </FieldInline>
            <FieldInline label="Vet payout (weekday)">
              <input type="number" value={svc.vetWeekday} onChange={(e) => updateService(i, 'vetWeekday', e.target.value)} style={styles.numInput} />
            </FieldInline>
            <FieldInline label="Vet payout (after-hours)">
              <input type="number" value={svc.vetAfterhours} onChange={(e) => updateService(i, 'vetAfterhours', e.target.value)} style={styles.numInput} />
            </FieldInline>
          </div>
        ))}
      </Card>

      <Card title="Cancellation policy">
        <p style={styles.gstHint}>
          What a client is charged when a booking is cancelled, based on how much notice was
          given. Admin can still waive or change the fee on any individual cancellation — this
          sets the default, not a rule you can't depart from.
        </p>

        <FieldInline label="Charge for late cancellations">
          <input
            type="checkbox"
            checked={pricing.cancellationPolicyEnabled === true}
            onChange={(e) => updateField(['cancellationPolicyEnabled'], e.target.checked)}
          />
        </FieldInline>

        {pricing.cancellationPolicyEnabled !== true && (
          <p style={styles.gstHint}>
            Currently off — no cancellation is charged. Turning this on affects future
            cancellations only.
          </p>
        )}

        <CancellationTiers
          tiers={pricing.cancellationTiers || []}
          onChange={(tiers) => updateField(['cancellationTiers'], tiers)}
        />
      </Card>

      <Card title="Transfer fee">
        <div style={styles.serviceRow}>
          <FieldInline label="Client pays">
            <input type="number" value={pricing.transferFee.clientPrice} onChange={(e) => updateField(['transferFee', 'clientPrice'], e.target.value)} style={styles.numInput} />
          </FieldInline>
          <FieldInline label="Vet payout (weekday)">
            <input type="number" value={pricing.transferFee.vetWeekday} onChange={(e) => updateField(['transferFee', 'vetWeekday'], e.target.value)} style={styles.numInput} />
          </FieldInline>
          <FieldInline label="Vet payout (after-hours)">
            <input type="number" value={pricing.transferFee.vetAfterhours} onChange={(e) => updateField(['transferFee', 'vetAfterhours'], e.target.value)} style={styles.numInput} />
          </FieldInline>
        </div>
      </Card>

      <Card title="General">
        <div style={styles.serviceRow}>
          <FieldInline label="After-hours surcharge">
            <input type="number" value={pricing.afterHoursSurcharge} onChange={(e) => updateField(['afterHoursSurcharge'], e.target.value)} style={styles.numInput} />
          </FieldInline>
          <FieldInline label="Public holiday surcharge">
            <input type="number" value={pricing.publicHolidaySurcharge ?? 0} onChange={(e) => updateField(['publicHolidaySurcharge'], e.target.value)} style={styles.numInput} />
          </FieldInline>
          <FieldInline label="Midnight fee (12am–6am)">
            <input type="number" value={pricing.midnightFeeSurcharge ?? 0} onChange={(e) => updateField(['midnightFeeSurcharge'], e.target.value)} style={styles.numInput} />
          </FieldInline>
          <FieldInline label="Communal cremation fee">
            <input type="number" value={pricing.communalCremationFee} onChange={(e) => updateField(['communalCremationFee'], e.target.value)} style={styles.numInput} />
          </FieldInline>
          <FieldInline label="GST %">
            <input type="number" value={pricing.gstPercent} onChange={(e) => updateField(['gstPercent'], e.target.value)} style={styles.numInput} />
          </FieldInline>
          <FieldInline label="Remind vets before appointments">
            <input
              type="checkbox"
              checked={pricing.remindersEnabled !== false}
              onChange={(e) => updateField(['remindersEnabled'], e.target.checked)}
            />
          </FieldInline>
          <FieldInline label="Hours before appointment">
            <input
              type="number" min="0.5" max="48" step="0.5"
              value={pricing.reminderHoursBefore ?? 2}
              onChange={(e) => updateField(['reminderHoursBefore'], e.target.value)}
              style={styles.numInput}
            />
          </FieldInline>
          <FieldInline label="Ask clients for feedback">
            <input
              type="checkbox"
              checked={pricing.reviewRemindersEnabled !== false}
              onChange={(e) => updateField(['reviewRemindersEnabled'], e.target.checked)}
            />
          </FieldInline>
          <FieldInline label="Days after the visit">
            <input
              type="number" min="1" max="30" step="1"
              value={pricing.reviewReminderDays ?? 2}
              onChange={(e) => updateField(['reviewReminderDays'], e.target.value)}
              style={styles.numInput}
            />
          </FieldInline>
          <FieldInline label="Business is GST registered">
            <input
              type="checkbox"
              checked={pricing.isGstRegistered === true}
              onChange={(e) => updateField(['isGstRegistered'], e.target.checked)}
            />
          </FieldInline>
        </div>
        <p style={styles.gstHint}>
          Clients who haven&apos;t left feedback get one text this many days after the visit, asking
          them to finalise their booking. Sent once, only between 9am and 7pm, and never to someone
          who has already reviewed.
        </p>
        <p style={styles.gstHint}>
          Vets get a push notification (and an SMS once the MSG91 template is configured) this many
          hours before each appointment they&apos;ve accepted. Reminders are sent once per job —
          changing the hours won&apos;t re-notify anyone already reminded.
        </p>
        <p style={styles.gstHint}>
          When ticked, client invoices and receipts show a GST breakdown and are labelled as tax
          invoices. Prices stay exactly as entered — GST is shown as the portion already included in
          the total, not added on top, so what the client pays doesn't change.
          {' '}Leave unticked if the business isn't registered: showing GST when you're not
          registered misstates a tax position. Check with your accountant if unsure.
        </p>
        <div>
        </div>
      </Card>

      <button onClick={onSave} disabled={saving} style={styles.saveBtn}>{saving ? 'Saving…' : saved ? 'Saved' : 'Save pricing'}</button>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="gm-card" style={{ padding: 18, marginBottom: 16 }}>
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginBottom: 12, fontFamily: 'var(--gm-font-body)', fontWeight: 600 }}>{title}</h3>
      {children}
    </div>
  );
}
function FieldInline({ label, children }) {
  return (
    <label style={{ fontSize: 11, color: 'var(--gm-ink-soft)', flex: 1 }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}

/**
 * Notice-period tiers. Each row is "with at least N hours notice, charge
 * X% of the bill". The engine sorts by hours before matching, so an
 * admin adding a row in the wrong place still gets sensible behaviour.
 */
function CancellationTiers({ tiers, onChange }) {
  const update = (i, key, value) => {
    const next = tiers.map((t, idx) => (idx === i ? { ...t, [key]: value } : t));
    onChange(next);
  };

  const add = () => onChange([...tiers, { hoursBefore: 0, percent: 0, label: '' }]);
  const remove = (i) => onChange(tiers.filter((_, idx) => idx !== i));

  const sorted = [...tiers].sort((a, b) => Number(b.hoursBefore) - Number(a.hoursBefore));

  return (
    <div style={styles.tierBox}>
      <div style={styles.tierHead}>
        <span style={{ flex: 2 }}>At least this much notice</span>
        <span style={{ flex: 1 }}>Charge</span>
        <span style={{ width: 60 }} />
      </div>

      {tiers.length === 0 && (
        <p style={styles.gstHint}>No tiers set — nothing will be charged.</p>
      )}

      {tiers.map((t, i) => (
        <div key={i} style={styles.tierRow}>
          <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number" min="0" step="1"
              value={t.hoursBefore ?? 0}
              onChange={(e) => update(i, 'hoursBefore', Number(e.target.value))}
              style={styles.numInput}
            />
            <span style={styles.tierUnit}>hours</span>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number" min="0" max="100" step="5"
              value={t.percent ?? 0}
              onChange={(e) => update(i, 'percent', Number(e.target.value))}
              style={styles.numInput}
            />
            <span style={styles.tierUnit}>%</span>
          </div>
          <button onClick={() => remove(i)} style={styles.tierRemove}>Remove</button>
        </div>
      ))}

      <button onClick={add} style={styles.tierAdd}>+ Add a tier</button>

      {/* Read back in plain words. A table of numbers is easy to
          misread, and this is the sentence that will be quoted to a
          client on the phone. */}
      {sorted.length > 0 && (
        <div style={styles.tierSummary}>
          {sorted.map((t, i) => {
            const next = sorted[i + 1];
            const range = next
              ? `${next.hoursBefore}–${t.hoursBefore} hours`
              : `${t.hoursBefore} hours or more`;
            const upper = i === 0 ? `More than ${t.hoursBefore} hours` : range;
            return (
              <div key={i}>
                {upper} notice: <strong>{Number(t.percent) === 0 ? 'no charge' : `${t.percent}% of the bill`}</strong>
              </div>
            );
          })}
          <div>
            Less than {sorted[sorted.length - 1].hoursBefore} hours, or after the appointment
            time: <strong>{sorted[sorted.length - 1].percent}% of the bill</strong>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  tierBox: { marginTop: 10 },
  tierHead: { display: 'flex', gap: 8, fontSize: 11, color: 'var(--gm-ink-soft)', marginBottom: 6 },
  tierRow: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
  tierUnit: { fontSize: 12, color: 'var(--gm-ink-soft)' },
  tierRemove: { width: 60, background: 'none', border: 'none', color: 'var(--gm-brick)', fontSize: 11, textDecoration: 'underline' },
  tierAdd: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '7px 14px', fontSize: 12, marginBottom: 12 },
  tierSummary: { fontSize: 12, color: 'var(--gm-ink-soft)', lineHeight: 1.8, background: 'var(--gm-line-soft)', padding: '10px 12px', borderRadius: 'var(--gm-radius-sm)' },
  gstHint: { fontSize: 11, color: 'var(--gm-ink-soft)', lineHeight: 1.5, marginTop: 10, fontStyle: 'italic' },
  serviceRow: { display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12 },
  input: { padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, background: '#fff' },
  numInput: { width: '100%', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, background: '#fff' },
  saveBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500 },
};
