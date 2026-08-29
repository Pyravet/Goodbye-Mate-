import { useEffect, useState } from 'react';
import BrochureManager from './BrochureManager.jsx';
import TwoFactorCard from './TwoFactorCard.jsx';
import { fetchClientResources, addClientResource, removeClientResource, verifyEmail, sendTestEmail, fetchContent, saveContent, fetchBrochurePdf, uploadBrochurePdf, removeBrochurePdf } from './settingsApi.js';

const TEXT_FIELDS = [
  { key: 'consentTemplate', label: 'Consent form text' },
  { key: 'educationalIntro', label: 'Educational intro (sent ahead of visit)' },
  { key: 'noCremationNote', label: 'No cremation chosen — note' },
  { key: 'privateCremationBrochure', label: 'Private cremation brochure text' },
  { key: 'communalCremationBrochure', label: 'Communal cremation brochure text' },
];

export default function ContentTab() {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchContent().then(setContent).catch(() => setContent(null)).finally(() => setLoading(false));
  }, []);

  const onSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await saveContent(content);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const setField = (key, value) => {
    setContent((c) => ({ ...c, [key]: value }));
    setSaved(false);
  };
  // Nested under bankDetails, defaulting to {} so an older settings row
  // without the block doesn't throw on first edit.
  const setBank = (key, value) => {
    setContent((c) => ({ ...c, bankDetails: { ...(c.bankDetails || {}), [key]: value } }));
    setSaved(false);
  };

  const setCompanyField = (key, value) => {
    setContent((c) => ({ ...c, company: { ...c.company, [key]: value } }));
    setSaved(false);
  };

  if (loading) return <p style={{ color: 'var(--gm-ink-soft)', fontSize: 13 }}>Loading…</p>;
  if (!content) return <p style={{ color: 'var(--gm-brick)', fontSize: 13 }}>Failed to load content settings.</p>;

  // Must sit AFTER the null guard above: content starts as null while
  // the settings load, and reading content.requestForm before that guard
  // threw on every render — which blanked the entire Content tab.
  // Defaults to {} so the form still renders if the requestForm block
  // hasn't been populated yet.
  const rf = content.requestForm || {};
  const setRf = (key) => (e) =>
    setContent((c) => ({ ...c, requestForm: { ...c.requestForm, [key]: e.target.value } }));

  return (
    <div>
      <Card title="Company details">
        <Field label="Company name"><input value={content.company.name} onChange={(e) => setCompanyField('name', e.target.value)} style={styles.input} /></Field>
        <Field label="ABN"><input value={content.company.abn} onChange={(e) => setCompanyField('abn', e.target.value)} style={styles.input} /></Field>
        <Field label="Address"><input value={content.company.address} onChange={(e) => setCompanyField('address', e.target.value)} style={styles.input} /></Field>
        <Field label="Phone"><input value={content.company.phone || ''} onChange={(e) => setCompanyField('phone', e.target.value)} placeholder="0400 000 000" style={styles.input} /></Field>
        <Field label="Email"><input value={content.company.email || ''} onChange={(e) => setCompanyField('email', e.target.value)} placeholder="hello@goodbyemate.com.au" style={styles.input} /></Field>
        <p style={styles.hint}>These appear in the header and footer of every quote, invoice, receipt and RCTI.</p>
        <Field label="RCTI declaration (appears on every vet's tax invoice)">
          <textarea value={content.company.rctiDeclaration} onChange={(e) => setCompanyField('rctiDeclaration', e.target.value)} rows={3} style={{ ...styles.input, resize: 'vertical' }} />
        </Field>
      </Card>

      <Card title="Client-facing text">
        {TEXT_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <textarea
              value={content[f.key] || ''}
              onChange={(e) => setField(f.key, e.target.value)}
              rows={3}
              style={{ ...styles.input, resize: 'vertical' }}
            />
          </Field>
        ))}
        <p style={styles.hint}>Use placeholders like {'{petName}'}, {'{date}'}, {'{time}'}, {'{vetName}'}, {'{crematorium}'} — these get filled in automatically.</p>
      </Card>

      <Card title="Support & grief resources">
        <ClientResources />
      </Card>

      <Card title="Bank details for invoices">
        <p style={styles.hint}>
          Printed on every invoice you issue to another business, so they can pay by transfer.
          These are your own account details and appear on the document — they are not treated
          as a secret.
        </p>
        <Field label="Account name">
          <input
            value={content.bankDetails?.accountName || ''}
            onChange={(e) => setBank('accountName', e.target.value)}
            style={styles.input}
          />
        </Field>
        <div style={styles.row}>
          <Field label="BSB">
            <input
              value={content.bankDetails?.bsb || ''}
              onChange={(e) => setBank('bsb', e.target.value)}
              placeholder="062-000" style={styles.input}
            />
          </Field>
          <Field label="Account number">
            <input
              value={content.bankDetails?.accountNumber || ''}
              onChange={(e) => setBank('accountNumber', e.target.value)}
              style={styles.input}
            />
          </Field>
        </div>
        <Field label="Bank">
          <input
            value={content.bankDetails?.bankName || ''}
            onChange={(e) => setBank('bankName', e.target.value)}
            style={styles.input}
          />
        </Field>
        <Field label="Payment terms">
          <input
            value={content.bankDetails?.paymentTerms || ''}
            onChange={(e) => setBank('paymentTerms', e.target.value)}
            placeholder="Payment due within 14 days." style={styles.input}
          />
        </Field>
      </Card>

      <Card title="Security — two-step verification">
        <TwoFactorCard />
      </Card>

      <Card title="Email delivery">
        <EmailDiagnostics />
      </Card>

      <Card title="Public request form">
        <p style={styles.hint}>
          The wording clients see at <strong>/request</strong>. This is read by someone who has just
          decided to put their pet down, so the tone matters more here than anywhere else in the
          product.
        </p>
        <Field label="Page title">
          <input value={rf.title || ''} onChange={setRf('title')} style={styles.input} />
        </Field>
        <Field label="Intro paragraph">
          <textarea value={rf.intro || ''} onChange={setRf('intro')} rows={3} style={{ ...styles.input, resize: 'vertical' }} />
        </Field>

        <Field label="Section heading — contact">
          <input value={rf.contactSectionTitle || ''} onChange={setRf('contactSectionTitle')} style={styles.input} />
        </Field>
        <Field label="Section heading — location">
          <input value={rf.locationSectionTitle || ''} onChange={setRf('locationSectionTitle')} style={styles.input} />
        </Field>
        <Field label="Section heading — pet">
          <input value={rf.petSectionTitle || ''} onChange={setRf('petSectionTitle')} style={styles.input} />
        </Field>
        <Field label="Section heading — service">
          <input value={rf.serviceSectionTitle || ''} onChange={setRf('serviceSectionTitle')} style={styles.input} />
        </Field>

        <Field label="Service options (one per line)">
          <textarea
            value={(rf.serviceOptions || []).join('\n')}
            onChange={(e) => setContent((c) => ({
              ...c,
              requestForm: {
                ...c.requestForm,
                // Blank lines dropped so a stray newline can't create an
                // empty, unselectable option in the dropdown.
                serviceOptions: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean),
              },
            }))}
            rows={4}
            style={{ ...styles.input, resize: 'vertical' }}
          />
        </Field>
        <p style={styles.hint}>
          These are the client-facing wordings only. You still confirm the actual service type when
          turning the request into a booking, so rewording an option can't change what gets booked.
        </p>

        <Field label="Timing question">
          <input value={rf.timingLabel || ''} onChange={setRf('timingLabel')} style={styles.input} />
        </Field>
        <Field label="Timing placeholder">
          <input value={rf.timingPlaceholder || ''} onChange={setRf('timingPlaceholder')} style={styles.input} />
        </Field>
        <Field label="Free-text question">
          <input value={rf.messageLabel || ''} onChange={setRf('messageLabel')} style={styles.input} />
        </Field>
        <Field label="Submit button">
          <input value={rf.submitLabel || ''} onChange={setRf('submitLabel')} style={styles.input} />
        </Field>
        <Field label="Privacy note">
          <input value={rf.privacyNote || ''} onChange={setRf('privacyNote')} style={styles.input} />
        </Field>

        <Field label="Thank you — title">
          <input value={rf.thankYouTitle || ''} onChange={setRf('thankYouTitle')} style={styles.input} />
        </Field>
        <Field label="Thank you — message">
          <textarea value={rf.thankYouBody || ''} onChange={setRf('thankYouBody')} rows={2} style={{ ...styles.input, resize: 'vertical' }} />
        </Field>
        <p style={styles.hint}>
          The client's phone number is appended automatically after this, so they can see we have
          the right one.
        </p>
        <Field label="Thank you — urgent note">
          <input value={rf.thankYouUrgent || ''} onChange={setRf('thankYouUrgent')} style={styles.input} />
        </Field>
      </Card>

      <Card title="Brochure PDFs">
        <p style={{ ...styles.hint, marginBottom: 14 }}>
          Attach a PDF brochure for each cremation option. Different cremation partners operate
          in different states, so you can upload one brochure per state — a booking gets its own
          state&apos;s brochure, or the nationwide copy if there isn&apos;t one.
        </p>
        <BrochureManager
          kind="private_cremation"
          label="Private cremation brochure, per state"
        />
        <div style={{ height: 18 }} />
        <BrochureManager
          kind="communal_cremation"
          label="Communal cremation brochure, per state"
        />
      </Card>

      <button onClick={onSave} disabled={saving} style={styles.saveBtn}>{saving ? 'Saving…' : saved ? 'Saved' : 'Save content'}</button>
    </div>
  );
}

/**
 * Two-step email check.
 *
 * "Check connection" verifies the SMTP handshake and login without
 * sending, which distinguishes a bad password or blocked port from a
 * delivery problem. "Send test email" then proves the whole path.
 * Both surface the provider's own error, because "535 auth failed" and
 * "550 relay denied" need completely different fixes and a generic
 * failure message tells you nothing.
 */
/**
 * Support and grief resources shown on the client journey page.
 *
 * The backend for this shipped with the per-state brochures but never
 * had a UI, so the feature existed and was unreachable — clients saw
 * nothing because nothing could be added.
 *
 * Each entry is either an uploaded PDF or a link out to a service.
 * A link is usually the better choice for something like a counselling
 * line, since the phone number stays current without anyone re-uploading
 * a document.
 */
function ClientResources() {
  const [items, setItems] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', url: '', state: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => fetchClientResources().then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.title.trim()) { setError('Give it a title.'); return; }
    if (!form.url.trim() && !file) { setError('Add a link or choose a PDF.'); return; }
    setBusy(true);
    setError('');
    try {
      let dataBase64 = null;
      if (file) {
        // Strip the data: prefix — the server expects raw base64.
        dataBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
      await addClientResource({
        title: form.title.trim(),
        description: form.description.trim() || null,
        url: form.url.trim() || null,
        state: form.state || null,
        dataBase64,
        filename: file ? file.name : null,
      });
      setForm({ title: '', description: '', url: '', state: '' });
      setFile(null);
      setAdding(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id, title) => {
    if (!window.confirm(`Remove "${title}" from the client journey?`)) return;
    try {
      await removeClientResource(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <p style={styles.hint}>
        Shown to clients on their journey page — counselling services, support lines, or documents
        you want to share. Euthanasia-only bookings see these too, since they have no aftercare
        step and are arguably who needs them most.
      </p>

      {error && <p style={styles.resError}>{error}</p>}

      {items === null ? (
        <p style={styles.hint}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={styles.hint}>Nothing added yet — clients currently see no resources.</p>
      ) : (
        items.map((r) => (
          <div key={r.id} style={styles.resRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.resTitle}>
                {r.url ? '\u{1F517}' : '\u{1F4C4}'} {r.title}
                {r.state && <span style={styles.resState}> · {r.state} only</span>}
              </div>
              {r.description && <div style={styles.resDesc}>{r.description}</div>}
            </div>
            <button onClick={() => remove(r.id, r.title)} style={styles.resRemove}>Remove</button>
          </div>
        ))
      )}

      {!adding ? (
        <button onClick={() => setAdding(true)} style={styles.emailBtn}>+ Add a resource</button>
      ) : (
        <div style={styles.resForm}>
          <Field label="Title">
            <input value={form.title} onChange={set('title')} placeholder="e.g. Pet Loss Support Line" style={styles.input} />
          </Field>
          <Field label="Description (optional)">
            <input value={form.description} onChange={set('description')} placeholder="e.g. Free counselling, 7 days" style={styles.input} />
          </Field>
          <Field label="Link">
            <input value={form.url} onChange={set('url')} placeholder="https://…" style={styles.input} />
          </Field>
          <Field label="…or upload a PDF instead">
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} style={styles.input} />
          </Field>
          <Field label="Show only in one state (optional)">
            <select value={form.state} onChange={set('state')} style={styles.input}>
              <option value="">All states</option>
              {['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((st) => <option key={st}>{st}</option>)}
            </select>
          </Field>
          <div style={styles.resActions}>
            <button onClick={() => { setAdding(false); setError(''); }} style={styles.resCancel}>Cancel</button>
            <button onClick={submit} disabled={busy} style={styles.emailBtn}>
              {busy ? 'Adding…' : 'Add resource'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function EmailDiagnostics() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      setResult(await verifyEmail());
    } catch (err) {
      setResult({ ok: false, error: err.message });
    } finally {
      setChecking(false);
    }
  };

  const test = async () => {
    setSending(true);
    setSendResult(null);
    try {
      const r = await sendTestEmail(to.trim());
      setSendResult({ ok: true, to: r.to });
    } catch (err) {
      setSendResult({ ok: false, error: err.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <p style={styles.hint}>
        Outgoing email sends quotes, invoices, veterinary records and client journey links.
        Check it here if any of those aren't arriving.
      </p>

      <button onClick={check} disabled={checking} style={styles.emailBtn}>
        {checking ? 'Checking…' : 'Check connection'}
      </button>

      {result && (
        <div style={result.ok ? styles.emailOk : styles.emailBad}>
          {result.ok
            ? `Connected to ${result.host}:${result.port} as ${result.user}.`
            : `Failed: ${result.error}`}
          {!result.ok && result.host && (
            <div style={styles.hint}>Tried {result.host}:{result.port} as {result.user}</div>
          )}
        </div>
      )}

      <div style={styles.emailTestRow}>
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="you@example.com"
          style={{ ...styles.input, marginBottom: 0 }}
        />
        <button onClick={test} disabled={sending || !to.trim()} style={styles.emailBtn}>
          {sending ? 'Sending…' : 'Send test email'}
        </button>
      </div>

      {sendResult && (
        <div style={sendResult.ok ? styles.emailOk : styles.emailBad}>
          {sendResult.ok ? `Sent to ${sendResult.to} — check the inbox (and spam).` : sendResult.error}
        </div>
      )}
    </>
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
function Field({ label, children }) {
  return (
    <label style={{ display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 14 }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}

const styles = {
  resRow: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--gm-line-soft)' },
  resTitle: { fontSize: 14, fontWeight: 500 },
  resState: { fontSize: 11, color: 'var(--gm-ink-soft)', fontWeight: 400 },
  resDesc: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  resRemove: { background: 'none', border: 'none', color: 'var(--gm-brick)', fontSize: 12, textDecoration: 'underline', flexShrink: 0 },
  resForm: { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--gm-line)' },
  resActions: { display: 'flex', gap: 8, marginTop: 4 },
  resCancel: { flex: 1, background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '9px 0', fontSize: 13 },
  resError: { fontSize: 12, color: 'var(--gm-brick)', marginBottom: 8 },
  emailBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '9px 16px', fontSize: 13, fontWeight: 500, flexShrink: 0 },
  emailTestRow: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 },
  emailOk: { fontSize: 12, color: 'var(--gm-forest)', background: '#E3E9E1', padding: '9px 11px', borderRadius: 'var(--gm-radius-sm)', marginTop: 10, lineHeight: 1.5 },
  emailBad: { fontSize: 12, color: 'var(--gm-brick)', background: 'var(--gm-brick-soft)', padding: '9px 11px', borderRadius: 'var(--gm-radius-sm)', marginTop: 10, lineHeight: 1.5, wordBreak: 'break-word' },
  input: { width: '100%', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, background: '#fff', fontFamily: 'inherit' },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', fontStyle: 'italic' },
  saveBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500 },
  brochureRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--gm-line-soft)' },
  brochureLabel: { fontSize: 13, fontWeight: 500 },
  brochureCurrent: { display: 'flex', alignItems: 'center', gap: 10 },
  brochureRemoveBtn: { background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '4px 10px', fontSize: 11, color: 'var(--gm-brick)' },
  brochureUploadBtn: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
};
