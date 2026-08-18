import { useState } from 'react';

/**
 * Download / email the veterinary record for a job.
 *
 * Deliberately allows sending to an address other than the client's:
 * pet insurers and referring vets frequently need this document, and
 * the client isn't always the one who asks for it.
 *
 * The API functions are injected rather than imported so this same
 * component works in both the admin and vet apps, which have separate
 * API layers.
 */
export default function VetRecordCard({
  clientEmail,
  hasNotes,
  onOpen,
  onEmail,
}) {
  const [showEmail, setShowEmail] = useState(false);
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState(null);

  const open = async () => {
    setError('');
    try {
      await onOpen();
    } catch (err) {
      setError(err.message);
    }
  };

  const send = async () => {
    setStatus('sending');
    setError('');
    try {
      // Empty `to` means "use the client's address on file" — the server
      // applies that default, so we don't duplicate the logic here.
      const result = await onEmail({ to: to.trim(), message: message.trim() });
      setStatus('sent');
      setTo('');
      setMessage('');
      // Show where it actually went, which matters when the field was
      // left blank and the server chose the address.
      setError('');
      setSentTo(result?.to || null);
    } catch (err) {
      setError(err.message);
      setStatus('idle');
    }
  };

  return (
    <>
      <p style={styles.hint}>
        A formal record of the visit — company and vet registration details, the pet's details, and the
        clinical notes. Pet insurers often ask clients for this.
      </p>

      {!hasNotes && (
        <p style={styles.warn}>
          No clinical notes have been recorded yet. The record will still generate, but it will say so.
        </p>
      )}

      <div style={styles.row}>
        <button onClick={open} style={styles.secondaryBtn}>Download record</button>
        <button onClick={() => setShowEmail((v) => !v)} style={styles.secondaryBtn}>
          {showEmail ? 'Cancel' : 'Email record'}
        </button>
      </div>

      {showEmail && (
        <div style={styles.form}>
          {error && <p style={styles.error}>{error}</p>}
          {status === 'sent' && <p style={styles.sent}>Sent to {sentTo}.</p>}

          <label style={styles.label}>
            Send to
            <input
              type="email"
              value={to}
              onChange={(e) => { setTo(e.target.value); setStatus('idle'); }}
              placeholder={clientEmail || 'insurer@example.com'}
              style={styles.input}
            />
          </label>
          <p style={styles.smallHint}>
            {clientEmail
              ? `Leave blank to send to the client (${clientEmail}).`
              : 'This booking has no client email on file, so an address is required.'}
          </p>

          <label style={styles.label}>
            Note to include (optional)
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder="e.g. As requested for your insurance claim."
              style={{ ...styles.input, resize: 'vertical' }}
            />
          </label>

          <button
            onClick={send}
            disabled={status === 'sending' || (!clientEmail && !to.trim())}
            style={styles.primaryBtn}
          >
            {status === 'sending' ? 'Sending…' : 'Send record'}
          </button>
        </div>
      )}
    </>
  );
}

const styles = {
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 10, lineHeight: 1.5 },
  warn: { fontSize: 12, color: '#7A5A22', background: 'var(--gm-honey-soft)', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', marginBottom: 10 },
  row: { display: 'flex', gap: 8 },
  secondaryBtn: { flex: 1, background: '#fff', color: 'var(--gm-forest)', border: '1px solid var(--gm-forest)', borderRadius: 'var(--gm-radius-sm)', padding: '9px 0', fontSize: 13, fontWeight: 500 },
  primaryBtn: { width: '100%', background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '10px 0', fontSize: 13, fontWeight: 500 },
  form: { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--gm-line)' },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 4 },
  input: { width: '100%', padding: '9px 10px', marginTop: 4, marginBottom: 4, borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, fontFamily: 'inherit', background: '#fff' },
  smallHint: { fontSize: 11, color: 'var(--gm-ink-soft)', marginBottom: 10, fontStyle: 'italic' },
  error: { fontSize: 12, color: 'var(--gm-brick)', marginBottom: 8 },
  sent: { fontSize: 12, color: 'var(--gm-forest)', marginBottom: 8, fontWeight: 500 },
};
