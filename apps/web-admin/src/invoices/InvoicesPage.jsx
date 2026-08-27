import { useState, useEffect, useCallback } from 'react';
import AppShell from '../layout/AppShell.jsx';
import {
  fetchInvoices, fetchInvoice, createInvoice, updateInvoice,
  sendInvoice, markInvoicePaid, voidInvoice, downloadInvoicePdf,
} from './invoicesApi.js';

const STATUS_LABEL = { draft: 'Draft', sent: 'Awaiting payment', paid: 'Paid', void: 'Voided' };
const STATUS_BADGE = { draft: '', sent: 'gm-badge--honey', paid: 'gm-badge--forest', void: 'gm-badge--brick' };

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtDate = (d) =>
  d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU',
    { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/**
 * Invoices issued to other businesses — crematorium partners, referring
 * clinics, corporate accounts.
 *
 * Separate from client invoices (issued to a pet owner for one job) and
 * from RCTIs (issued on behalf of a vet). Different recipient, different
 * numbering, different GST treatment.
 */
export default function InvoicesPage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState(null); // invoice id, or 'new'
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchInvoices(status).then(setData).catch((e) => { setError(e.message); setData({ invoices: [] }); });
  }, [status]);

  useEffect(() => { load(); }, [load]);

  if (editing) {
    return (
      <AppShell>
        <div style={styles.page}>
          <InvoiceEditor
            invoiceId={editing === 'new' ? null : editing}
            onClose={() => { setEditing(null); load(); }}
          />
        </div>
      </AppShell>
    );
  }

  const summary = data?.summary || {};

  return (
    <AppShell>
      <div style={styles.page}>
        <div style={styles.head}>
          <h1 style={styles.title}>Invoices</h1>
          <button onClick={() => setEditing('new')} style={styles.newBtn}>+ New invoice</button>
        </div>
        <p style={styles.subtitle}>
          Invoices you issue to other businesses — crematorium partners, clinics, corporate
          accounts. Client invoices and vet RCTIs are handled separately.
        </p>

        {error && <p style={styles.error}>{error}</p>}

        {data && (
          <div style={styles.stats}>
            <Stat label="Awaiting payment" value={money(summary.outstanding)} warn={Number(summary.outstanding) > 0} />
            <Stat label="Unpaid invoices" value={summary.unpaid_count ?? 0} />
            <Stat label="Paid to date" value={money(summary.paid_total)} />
          </div>
        )}

        <div style={styles.filters}>
          {['all', 'draft', 'sent', 'paid', 'void'].map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              style={{ ...styles.filterBtn, ...(status === s ? styles.filterOn : {}) }}
            >
              {s === 'all' ? 'All' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {!data ? (
          <p style={styles.empty}>Loading…</p>
        ) : data.invoices.length === 0 ? (
          <p style={styles.empty}>No invoices here yet.</p>
        ) : (
          data.invoices.map((inv) => (
            <div key={inv.id} className="gm-card" style={styles.row}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.rowTop}>
                  <span style={styles.number}>{inv.invoice_number || 'Draft'}</span>
                  <span className={`gm-badge ${STATUS_BADGE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
                </div>
                <div style={styles.recipient}>{inv.recipient_name}</div>
                <div style={styles.meta}>
                  Issued {fmtDate(inv.issue_date)}
                  {inv.due_date && inv.status === 'sent' && ` · due ${fmtDate(inv.due_date)}`}
                </div>
              </div>
              <div style={styles.rowRight}>
                <div style={styles.total}>{money(inv.total)}</div>
                <button onClick={() => setEditing(inv.id)} style={styles.openBtn}>Open</button>
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}

function Stat({ label, value, warn }) {
  return (
    <div style={styles.stat}>
      <div style={{ ...styles.statValue, ...(warn ? styles.statWarn : {}) }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

/** Create or edit an invoice, and act on it once issued. */
function InvoiceEditor({ invoiceId, onClose }) {
  const [invoice, setInvoice] = useState(null);
  const [form, setForm] = useState({
    recipientName: '', recipientEmail: '', recipientAbn: '', recipientAddress: '',
    issueDate: new Date().toLocaleDateString('en-CA'), dueDate: '', notes: '',
  });
  const [items, setItems] = useState([{ description: '', quantity: 1, unitAmount: 0 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!invoiceId) return;
    fetchInvoice(invoiceId).then(({ invoice: inv, items: its }) => {
      setInvoice(inv);
      setForm({
        recipientName: inv.recipient_name || '',
        recipientEmail: inv.recipient_email || '',
        recipientAbn: inv.recipient_abn || '',
        recipientAddress: inv.recipient_address || '',
        issueDate: String(inv.issue_date).slice(0, 10),
        dueDate: inv.due_date ? String(inv.due_date).slice(0, 10) : '',
        notes: inv.notes || '',
      });
      setItems(its.length ? its.map((i) => ({
        description: i.description, quantity: Number(i.quantity), unitAmount: Number(i.unit_amount),
      })) : [{ description: '', quantity: 1, unitAmount: 0 }]);
    }).catch((e) => setError(e.message));
  }, [invoiceId]);

  const isDraft = !invoice || invoice.status === 'draft';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const setItem = (i, key, value) =>
    setItems((list) => list.map((it, idx) => (idx === i ? { ...it, [key]: value } : it)));

  // Preview only. The server recomputes and stores its own totals, so
  // this can never be what gets billed — it exists so admin sees the
  // number before committing to it.
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitAmount) || 0), 0);

  const save = async () => {
    if (!form.recipientName.trim()) { setError('Who is this invoice for?'); return; }
    setBusy(true);
    setError('');
    try {
      const payload = { ...form, items: items.filter((i) => i.description.trim()) };
      const result = invoiceId
        ? await updateInvoice(invoiceId, payload)
        : await createInvoice(payload);
      setInvoice(result.invoice);
      setNotice('Saved.');
      if (!invoiceId) onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!window.confirm(
      'Issue this invoice? It gets an invoice number and can no longer be edited — '
      + 'you would have to void it and raise a new one.'
    )) return;
    setBusy(true);
    setError('');
    try {
      const result = await sendInvoice(invoice.id);
      setInvoice(result.invoice);
      // Reported honestly. Telling admin it was emailed when it wasn't
      // is how an unpaid invoice goes unchased for a month.
      setNotice(result.emailed
        ? `Issued as ${result.invoice.invoice_number} and emailed to ${result.invoice.recipient_email}.`
        : `Issued as ${result.invoice.invoice_number}, but NOT emailed — ${result.emailError} Download the PDF and send it yourself.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const result = await fn();
      setInvoice(result.invoice);
      setNotice('Updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={onClose} style={styles.back}>← All invoices</button>
      <h1 style={styles.title}>
        {invoice?.invoice_number || (invoiceId ? 'Draft invoice' : 'New invoice')}
      </h1>

      {error && <p style={styles.error}>{error}</p>}
      {notice && <p style={styles.notice}>{notice}</p>}

      {invoice && !isDraft && (
        <p style={styles.lockedNote}>
          This invoice has been issued, so it can no longer be edited — the recipient already has
          a copy, and changing ours would mean the two no longer match. Void it and raise a new
          one if something is wrong.
        </p>
      )}

      <div className="gm-card" style={styles.card}>
        <h3 style={styles.cardTitle}>Bill to</h3>
        <Field label="Business name">
          <input value={form.recipientName} onChange={set('recipientName')} disabled={!isDraft} style={styles.input} />
        </Field>
        <div style={styles.formRow}>
          <Field label="Email (for sending)">
            <input type="email" value={form.recipientEmail} onChange={set('recipientEmail')} disabled={!isDraft} style={styles.input} />
          </Field>
          <Field label="ABN">
            <input value={form.recipientAbn} onChange={set('recipientAbn')} disabled={!isDraft} style={styles.input} />
          </Field>
        </div>
        <Field label="Address">
          <input value={form.recipientAddress} onChange={set('recipientAddress')} disabled={!isDraft} style={styles.input} />
        </Field>
        <div style={styles.formRow}>
          <Field label="Issue date">
            <input type="date" value={form.issueDate} onChange={set('issueDate')} disabled={!isDraft} style={styles.input} />
          </Field>
          <Field label="Due date">
            <input type="date" value={form.dueDate} onChange={set('dueDate')} disabled={!isDraft} style={styles.input} />
          </Field>
        </div>
      </div>

      <div className="gm-card" style={styles.card}>
        <h3 style={styles.cardTitle}>Lines</h3>
        {items.map((item, i) => (
          <div key={i} style={styles.itemRow}>
            <input
              value={item.description}
              onChange={(e) => setItem(i, 'description', e.target.value)}
              placeholder="e.g. Collection & transport — September"
              disabled={!isDraft}
              style={{ ...styles.input, flex: 3 }}
            />
            <input
              type="number" step="0.01" value={item.quantity}
              onChange={(e) => setItem(i, 'quantity', e.target.value)}
              disabled={!isDraft} style={{ ...styles.input, width: 70 }}
            />
            <input
              type="number" step="0.01" value={item.unitAmount}
              onChange={(e) => setItem(i, 'unitAmount', e.target.value)}
              disabled={!isDraft} style={{ ...styles.input, width: 90 }}
            />
            <span style={styles.lineTotal}>
              {money((Number(item.quantity) || 0) * (Number(item.unitAmount) || 0))}
            </span>
            {isDraft && items.length > 1 && (
              <button onClick={() => setItems(items.filter((_, idx) => idx !== i))} style={styles.removeLine}>×</button>
            )}
          </div>
        ))}

        {isDraft && (
          <button
            onClick={() => setItems([...items, { description: '', quantity: 1, unitAmount: 0 }])}
            style={styles.addLine}
          >
            + Add a line
          </button>
        )}

        <div style={styles.totals}>
          <div style={styles.totalRow}>
            <span>Subtotal</span>
            <span>{money(invoice && !isDraft ? invoice.subtotal : subtotal)}</span>
          </div>
          {invoice && Number(invoice.gst) > 0 && (
            <div style={styles.totalRow}><span>GST</span><span>{money(invoice.gst)}</span></div>
          )}
          <div style={{ ...styles.totalRow, ...styles.grandTotal }}>
            <span>Total</span>
            <span>{money(invoice && !isDraft ? invoice.total : subtotal)}</span>
          </div>
          {isDraft && (
            <p style={styles.gstHint}>
              Enter amounts <strong>excluding GST</strong>. If the business is GST registered,
              GST is added on top when the invoice is issued.
            </p>
          )}
        </div>
      </div>

      <div className="gm-card" style={styles.card}>
        <h3 style={styles.cardTitle}>Notes</h3>
        <textarea
          value={form.notes} onChange={set('notes')} rows={2}
          disabled={!isDraft} placeholder="Shown on the invoice" style={styles.input}
        />
      </div>

      <div style={styles.actions}>
        {isDraft && (
          <button onClick={save} disabled={busy} style={styles.saveBtn}>
            {busy ? 'Saving…' : 'Save draft'}
          </button>
        )}
        {invoice && (
          <button
            onClick={() => downloadInvoicePdf(invoice.id, invoice.invoice_number).catch((e) => setError(e.message))}
            style={styles.secondaryBtn}
          >
            Download PDF
          </button>
        )}
        {invoice && isDraft && (
          <button onClick={send} disabled={busy} style={styles.sendBtn}>Issue & send</button>
        )}
        {invoice?.status === 'sent' && (
          <button
            onClick={() => act(() => markInvoicePaid(invoice.id))}
            disabled={busy} style={styles.sendBtn}
          >
            Mark paid
          </button>
        )}
        {invoice && invoice.status !== 'paid' && invoice.status !== 'void' && (
          <button
            onClick={() => act(
              () => voidInvoice(invoice.id, window.prompt('Reason for voiding?') || ''),
              'Void this invoice? The number stays on record — a missing number looks like a hidden transaction.'
            )}
            disabled={busy} style={styles.voidBtn}
          >
            Void
          </button>
        )}
      </div>
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
  page: { padding: '24px 28px', maxWidth: 760 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, marginBottom: 4 },
  subtitle: { fontSize: 13, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 18 },
  back: { background: 'none', border: 'none', color: 'var(--gm-ink-soft)', fontSize: 13, marginBottom: 10, padding: 0 },
  newBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '9px 16px', fontSize: 13, fontWeight: 500 },
  error: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 12 },
  notice: { fontSize: 13, color: '#7A5A22', background: 'var(--gm-honey-soft)', padding: '10px 12px', borderRadius: 'var(--gm-radius-sm)', marginBottom: 12, lineHeight: 1.5 },
  lockedNote: { fontSize: 12, color: 'var(--gm-ink-soft)', background: 'var(--gm-line-soft)', padding: '10px 12px', borderRadius: 'var(--gm-radius-sm)', marginBottom: 14, lineHeight: 1.5 },
  stats: { display: 'flex', gap: 8, marginBottom: 16 },
  stat: { flex: 1, background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '12px 10px', textAlign: 'center' },
  statValue: { fontFamily: 'var(--gm-font-display)', fontSize: 18, fontWeight: 600, color: 'var(--gm-forest-dark)' },
  statWarn: { color: '#7A5A22' },
  statLabel: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 2 },
  filters: { display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' },
  filterBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 999, padding: '7px 14px', fontSize: 12 },
  filterOn: { background: 'var(--gm-forest)', color: '#fff', borderColor: 'var(--gm-forest)' },
  empty: { fontSize: 13, color: 'var(--gm-ink-soft)' },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8 },
  rowTop: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 },
  number: { fontSize: 13, fontWeight: 600, fontFamily: 'monospace' },
  recipient: { fontSize: 15, fontWeight: 500 },
  meta: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 2 },
  rowRight: { textAlign: 'right', flexShrink: 0 },
  total: { fontFamily: 'var(--gm-font-display)', fontSize: 16, fontWeight: 600, marginBottom: 4 },
  openBtn: { background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '5px 12px', fontSize: 12 },
  card: { padding: 16, marginBottom: 12 },
  cardTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 15, fontWeight: 600, marginBottom: 10 },
  field: { display: 'block', flex: 1, minWidth: 0, marginBottom: 10 },
  label: { display: 'block', fontSize: 11, color: 'var(--gm-ink-soft)', marginBottom: 3 },
  input: { width: '100%', padding: '9px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, fontFamily: 'inherit', background: '#fff' },
  formRow: { display: 'flex', gap: 8 },
  itemRow: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 },
  lineTotal: { fontSize: 13, minWidth: 78, textAlign: 'right', fontWeight: 500 },
  removeLine: { background: 'none', border: 'none', color: 'var(--gm-brick)', fontSize: 18, padding: '0 4px' },
  addLine: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '7px 14px', fontSize: 12, marginBottom: 12 },
  totals: { borderTop: '1px solid var(--gm-line)', paddingTop: 10 },
  totalRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', color: 'var(--gm-ink-soft)' },
  grandTotal: { fontSize: 17, fontWeight: 600, color: 'var(--gm-ink)', paddingTop: 6 },
  gstHint: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 8, lineHeight: 1.5 },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  saveBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '10px 20px', fontSize: 14, fontWeight: 500 },
  sendBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '10px 20px', fontSize: 14, fontWeight: 500 },
  secondaryBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '10px 20px', fontSize: 14 },
  voidBtn: { background: '#fff', color: 'var(--gm-brick)', border: '1px solid var(--gm-brick)', borderRadius: 'var(--gm-radius-sm)', padding: '10px 20px', fontSize: 14 },
};
