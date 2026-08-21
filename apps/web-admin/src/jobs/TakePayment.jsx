import { useState } from 'react';
import { formatExpiry } from '@goodbye-mate/web-shared/src/format.js';
import { chargeJob } from './jobsApi.js';

const PUBLIC_API_KEY = import.meta.env.VITE_EWAY_PUBLIC_API_KEY;


export default function TakePayment({ jobId, amount, onSuccess }) {
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvn, setCvn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const scriptReady = typeof window !== 'undefined' && !!window.eCrypt;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!scriptReady) {
      setError('Payment form is still loading — try again in a moment.');
      return;
    }
    if (!PUBLIC_API_KEY) {
      setError('Payment isn\u2019t configured on this deployment yet.');
      return;
    }

    // eWay's Client Side Encryption key is a long RSA public key (~400+
    // characters). The eWay *API key* (epk-XXXX-...) is a different
    // credential entirely and cannot encrypt anything — passing it here
    // produces the cryptic "message too long for RSA", because the
    // library derives a tiny modulus from it and any card number
    // overflows. Checking the length turns that into an answer.
    if (!PUBLIC_API_KEY || PUBLIC_API_KEY.length < 100) {
      setError(
        'Card payments are not configured correctly: the eWay Client Side Encryption key is missing '
        + 'or is an API key rather than an encryption key. It should be a long block of characters, '
        + 'not "epk-...". Get it from eWay under My Account > API Key > Client Side Encryption.'
      );
      setSubmitting(false);
      return;
    }
    const [expiryMonth, expiryYear] = expiry.split('/');
    if (!expiryMonth || !expiryYear) {
      setError('Enter expiry as MM/YY.');
      return;
    }

    setSubmitting(true);
    try {
      // Every field is encrypted in the browser right here — the raw
      // card number/CVN are never sent anywhere, including our own
      // server. Only these encrypted strings leave this page.
      const encryptedCard = {
        number: window.eCrypt.encryptValue(cardNumber.replace(/\s/g, ''), PUBLIC_API_KEY),
        expiryMonth: window.eCrypt.encryptValue(expiryMonth, PUBLIC_API_KEY),
        expiryYear: window.eCrypt.encryptValue(expiryYear, PUBLIC_API_KEY),
        cvn: window.eCrypt.encryptValue(cvn, PUBLIC_API_KEY),
      };

      const result = await chargeJob(jobId, encryptedCard);
      onSuccess(result);
    } catch (err) {
      setError(err.declined ? `Card declined: ${err.message}` : err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} style={styles.form}>
      {error && <p style={styles.error}>{error}</p>}
      <p style={styles.amount}>Charging ${amount.toFixed(2)}</p>

      <label style={styles.label}>
        Name on card
        <input value={cardName} onChange={(e) => setCardName(e.target.value)} required style={styles.input} />
      </label>
      <label style={styles.label}>
        Card number
        <input
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="4444 3333 2222 1111"
          required
          style={styles.input}
        />
      </label>
      <div style={styles.row}>
        <label style={{ ...styles.label, flex: 1 }}>
          Expiry (MM/YY)
          <input
            value={expiry}
            onChange={(e) => setExpiry(formatExpiry(e.target.value))}
            inputMode="numeric"
            placeholder="12/28"
            autoComplete="cc-exp"
            required
            style={styles.input}
          />
        </label>
        <label style={{ ...styles.label, flex: 1 }}>
          CVN
          <input
            value={cvn}
            onChange={(e) => setCvn(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            autoComplete="cc-csc"
            required
            style={styles.input}
          />
        </label>
      </div>

      <button type="submit" disabled={submitting} style={styles.submitBtn}>
        {submitting ? 'Processing…' : `Charge $${amount.toFixed(2)}`}
      </button>
      <p style={styles.hint}>Sandbox card 4444333322221111 with any future expiry and CVN approves the payment.</p>
    </form>
  );
}

const styles = {
  form: { marginTop: 4 },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 12 },
  input: { display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, background: '#fff' },
  row: { display: 'flex', gap: 12 },
  amount: { fontFamily: 'var(--gm-font-display)', fontSize: 18, fontWeight: 600, marginBottom: 14 },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 12 },
  submitBtn: { width: '100%', background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '11px', borderRadius: 'var(--gm-radius-sm)', fontSize: 14, fontWeight: 500, marginTop: 4 },
  hint: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 10, fontStyle: 'italic' },
};
