import { useState } from 'react';
import { apiFetch } from '../api.js';

const EXPORTS = [
  {
    key: 'jobs',
    label: 'Jobs',
    description: 'Every booking with client, pet, vet, service, status, and any extras or discounts.',
  },
  {
    key: 'payments',
    label: 'Payments & refunds',
    description: 'The full ledger. Refunds appear as negative amounts, so summing the Amount column gives your net position rather than gross takings.',
  },
  {
    key: 'payouts',
    label: 'Vet payouts',
    description: 'Approved and paid weekly periods with RCTI numbers and GST split, for reconciling against what you actually paid out.',
  },
];

export default function ExportsTab() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  /**
   * CSVs need the auth header, so they're fetched and turned into a
   * download rather than linked directly — a plain <a href> sends no
   * Authorization header and would just 401.
   */
  const download = async (key) => {
    setBusy(key);
    setError('');
    try {
      const params = [];
      if (from) params.push(`from=${from}`);
      if (to) params.push(`to=${to}`);
      const qs = params.length ? `?${params.join('&')}` : '';

      const res = await apiFetch(`/exports/${key}.csv${qs}`);
      if (!res.ok) throw new Error(`Could not export (HTTP ${res.status}).`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `goodbye-mate-${key}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Delayed revoke: revoking immediately can race the browser's read
      // and produce an empty file on slower machines.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p style={styles.intro}>
        Download your data as CSV, ready for Excel, Google Sheets or your accountant.
        Leave the dates blank to export everything.
      </p>

      <div style={styles.dateRow}>
        <label style={styles.dateField}>
          <span style={styles.label}>From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={styles.input} />
        </label>
        <label style={styles.dateField}>
          <span style={styles.label}>To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={styles.input} />
        </label>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      {EXPORTS.map((e) => (
        <div key={e.key} className="gm-card" style={styles.card}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.cardTitle}>{e.label}</div>
            <div style={styles.cardDesc}>{e.description}</div>
          </div>
          <button onClick={() => download(e.key)} disabled={busy === e.key} style={styles.btn}>
            {busy === e.key ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
      ))}
    </div>
  );
}

const styles = {
  intro: { fontSize: 13, color: 'var(--gm-ink-soft)', lineHeight: 1.5, marginBottom: 16 },
  dateRow: { display: 'flex', gap: 10, marginBottom: 16, maxWidth: 360 },
  dateField: { flex: 1 },
  label: { display: 'block', fontSize: 11, color: 'var(--gm-ink-soft)', marginBottom: 3 },
  input: { width: '100%', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, background: '#fff' },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 10 },
  card: { display: 'flex', alignItems: 'center', gap: 14, padding: 16, marginBottom: 10 },
  cardTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 16, fontWeight: 600 },
  cardDesc: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 3, lineHeight: 1.5 },
  btn: { flexShrink: 0, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '10px 16px', fontSize: 13, fontWeight: 500 },
};
