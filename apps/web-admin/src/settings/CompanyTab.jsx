import { useEffect, useState } from 'react';
import { fetchContent, saveContent, fetchPricing } from './settingsApi.js';

// Company details printed on every quote, invoice, receipt and RCTI, and
// shown to clients. Lives in its own tab so it is easy to find; it reads
// and writes the same content_settings.company record as before.
export default function CompanyTab() {
  const [content, setContent] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchContent().then(setContent).catch(() => setError('Could not load company details.'));
    fetchPricing().then(setPricing).catch(() => {});
  }, []);

  if (error && !content) return <p style={s.err}>{error}</p>;
  if (!content) return <p style={s.hint}>Loading…</p>;

  const company = content.company || {};
  const set = (key) => (e) => {
    setContent((c) => ({ ...c, company: { ...(c.company || {}), [key]: e.target.value } }));
    setSaved(false);
  };

  const onSave = async () => {
    setSaving(true); setError('');
    try {
      // Re-read just before writing so this tab can't overwrite
      // changes made in Content settings since it was opened.
      const latest = await fetchContent();
      await saveContent({ ...latest, company: content.company });
      setSaved(true);
    } catch (e) {
      setError(e.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const gstOn = pricing?.isGstRegistered === true;

  return (
    <div>
      <div className="gm-card" style={s.card}>
        <h3 style={s.cardTitle}>Company details</h3>
        <p style={s.hint}>Printed in the header and footer of every quote, invoice, receipt and RCTI.</p>
        <Field label="Company / trading name"><input value={company.name || ''} onChange={set('name')} style={s.input} /></Field>
        <Field label="ABN"><input value={company.abn || ''} onChange={set('abn')} placeholder="11 digit ABN" style={s.input} /></Field>
        <Field label="Address"><input value={company.address || ''} onChange={set('address')} style={s.input} /></Field>
        <Field label="Phone"><input value={company.phone || ''} onChange={set('phone')} placeholder="0400 000 000" style={s.input} /></Field>
        <Field label="Email"><input value={company.email || ''} onChange={set('email')} placeholder="hello@goodbyemate.com.au" style={s.input} /></Field>
        <Field label="Website"><input value={company.website || ''} onChange={set('website')} placeholder="www.goodbyemate.com.au" style={s.input} /></Field>
        <Field label="RCTI declaration (appears on every vet's tax invoice)">
          <textarea value={company.rctiDeclaration || ''} onChange={set('rctiDeclaration')} rows={3} style={{ ...s.input, resize: 'vertical' }} />
        </Field>
        {error && <p style={s.err}>{error}</p>}
        <button onClick={onSave} disabled={saving} style={s.save}>{saving ? 'Saving…' : saved ? 'Saved' : 'Save company details'}</button>
      </div>

      <div className="gm-card" style={{ ...s.card, borderColor: gstOn ? 'var(--gm-line)' : 'var(--gm-brick)' }}>
        <h3 style={s.cardTitle}>GST on client invoices</h3>
        {pricing === null ? <p style={s.hint}>Checking…</p> : gstOn ? (
          <p style={s.hint}>
            GST registered — client invoices and receipts are labelled <strong>Tax Invoice</strong> and show the
            {' '}{pricing.gstPercent ?? 10}% GST included in the total.
            {!company.abn && <strong style={{ color: 'var(--gm-brick)' }}> Add your ABN above: a tax invoice must show it.</strong>}
          </p>
        ) : (
          <p style={{ ...s.hint, color: 'var(--gm-brick)' }}>
            GST is switched OFF, so client invoices show no GST and are labelled plain &ldquo;Invoice&rdquo;. If the
            business is registered for GST, tick <strong>Settings → Pricing → GST → Business is GST registered</strong>.
            Prices are GST-inclusive, so the totals clients pay will not change.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 14 }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}

const s = {
  card: { padding: 18, marginBottom: 16, border: '1px solid var(--gm-line)' },
  cardTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginBottom: 12, fontFamily: 'var(--gm-font-body)', fontWeight: 600 },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', margin: '0 0 12px', lineHeight: 1.5 },
  err: { fontSize: 13, color: 'var(--gm-brick)', margin: '0 0 10px' },
  input: { width: '100%', padding: 9, border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' },
  save: { background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500 },
};
