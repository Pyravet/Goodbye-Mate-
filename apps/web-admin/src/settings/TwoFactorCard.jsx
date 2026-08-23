import { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';

/**
 * Two-factor setup and management.
 *
 * Three states: off, mid-setup (QR shown, awaiting confirmation), and on.
 * The middle state exists because the server deliberately doesn't enable
 * 2FA until a code is confirmed — so someone who scans the QR and then
 * loses their phone isn't locked out of their own account.
 */
export default function TwoFactorCard() {
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);        // { qrDataUrl, secret }
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    apiFetch('/auth/2fa/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ enabled: false }));

  useEffect(() => { load(); }, []);

  const begin = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/auth/2fa/setup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start setup');
      setSetup(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/auth/2fa/confirm', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'That code was not accepted');
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setCode('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ password, code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not turn off two-step verification');
      setDisabling(false);
      setPassword('');
      setCode('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (status === null) return <p style={styles.hint}>Loading…</p>;

  // --- Recovery codes, shown exactly once ---
  if (recoveryCodes) {
    return (
      <>
        <p style={styles.success}>Two-step verification is on.</p>
        <p style={styles.warn}>
          Save these recovery codes somewhere safe now. They are stored hashed and
          <strong> cannot be shown again</strong>. Each one works once, and they are the only way
          back in if you lose your phone.
        </p>
        <div style={styles.codeGrid}>
          {recoveryCodes.map((c) => <code key={c} style={styles.recoveryCode}>{c}</code>)}
        </div>
        <button
          onClick={() => navigator.clipboard?.writeText(recoveryCodes.join('\n'))}
          style={styles.secondaryBtn}
        >
          Copy all
        </button>
        <button onClick={() => setRecoveryCodes(null)} style={styles.primaryBtn}>
          I've saved them
        </button>
      </>
    );
  }

  // --- Mid-setup: QR shown, awaiting confirmation ---
  if (setup) {
    return (
      <>
        <p style={styles.hint}>
          Scan this with Google Authenticator, Authy, 1Password, or your phone's built-in
          password app — then enter the 6-digit code it shows.
        </p>
        {error && <p style={styles.error}>{error}</p>}

        <img src={setup.qrDataUrl} alt="Two-factor QR code" style={styles.qr} />

        {/* Typing the secret by hand is the fallback when there's no
            camera, or the QR won't scan on a desktop screen. */}
        <details style={styles.details}>
          <summary style={styles.summary}>Can't scan it?</summary>
          <p style={styles.hint}>Enter this key into your app manually:</p>
          <code style={styles.secret}>{setup.secret}</code>
        </details>

        <label style={styles.label}>
          Code from your app
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            placeholder="123456"
            style={{ ...styles.input, letterSpacing: 3, textAlign: 'center' }}
            autoFocus
          />
        </label>

        <div style={styles.row}>
          <button onClick={() => { setSetup(null); setCode(''); setError(''); }} style={styles.secondaryBtn}>
            Cancel
          </button>
          <button onClick={confirm} disabled={busy || code.trim().length < 6} style={styles.primaryBtn}>
            {busy ? 'Checking…' : 'Turn on'}
          </button>
        </div>
      </>
    );
  }

  // --- On ---
  if (status.enabled) {
    return (
      <>
        <p style={styles.success}>
          Two-step verification is on
          {status.enabledAt && ` — since ${new Date(status.enabledAt).toLocaleDateString('en-AU')}`}.
        </p>
        <p style={styles.hint}>
          {status.recoveryCodesRemaining} recovery code
          {status.recoveryCodesRemaining === 1 ? '' : 's'} remaining.
          {status.recoveryCodesRemaining <= 2 && (
            <strong> Running low — turn it off and on again to get a fresh set.</strong>
          )}
        </p>

        {error && <p style={styles.error}>{error}</p>}

        {!disabling ? (
          <button onClick={() => setDisabling(true)} style={styles.dangerBtn}>
            Turn off two-step verification
          </button>
        ) : (
          <div style={styles.disableBox}>
            <p style={styles.hint}>
              Confirm with your password and a current code. Both are required even though
              you're signed in — otherwise anyone using your open browser could turn this off.
            </p>
            <label style={styles.label}>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={styles.input} />
            </label>
            <label style={styles.label}>
              Current code
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" style={styles.input} />
            </label>
            <div style={styles.row}>
              <button onClick={() => { setDisabling(false); setError(''); }} style={styles.secondaryBtn}>
                Cancel
              </button>
              <button onClick={disable} disabled={busy || !password || !code} style={styles.dangerBtn}>
                {busy ? 'Turning off…' : 'Turn off'}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // --- Off ---
  return (
    <>
      <p style={styles.hint}>
        Adds a second step when signing in: your password, then a code from your phone.
        This account can see payment details, vet bank details and clinical records, so a
        password alone is thin protection if it's ever guessed or reused.
      </p>
      {error && <p style={styles.error}>{error}</p>}
      <button onClick={begin} disabled={busy} style={styles.primaryBtn}>
        {busy ? 'Preparing…' : 'Set up two-step verification'}
      </button>
    </>
  );
}

const styles = {
  hint: { fontSize: 13, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 12 },
  success: { fontSize: 14, color: 'var(--gm-forest)', fontWeight: 500, marginBottom: 8 },
  warn: { fontSize: 13, color: '#7A5A22', background: 'var(--gm-honey-soft)', padding: '10px 12px', borderRadius: 'var(--gm-radius-sm)', lineHeight: 1.6, marginBottom: 12 },
  error: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 10 },
  qr: { display: 'block', margin: '0 auto 14px', width: 200, height: 200, borderRadius: 'var(--gm-radius-sm)' },
  details: { marginBottom: 14 },
  summary: { fontSize: 12, color: 'var(--gm-forest)', cursor: 'pointer' },
  secret: { display: 'block', fontFamily: 'monospace', fontSize: 13, background: 'var(--gm-line-soft)', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', wordBreak: 'break-all' },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 10 },
  input: { width: '100%', padding: '10px 12px', marginTop: 4, borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 15, fontFamily: 'inherit', background: '#fff' },
  row: { display: 'flex', gap: 8 },
  primaryBtn: { flex: 1, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '11px 0', fontSize: 14, fontWeight: 500 },
  secondaryBtn: { flex: 1, background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '11px 0', fontSize: 14, fontWeight: 500, marginBottom: 8 },
  dangerBtn: { flex: 1, background: '#fff', color: 'var(--gm-brick)', border: '1px solid var(--gm-brick)', borderRadius: 'var(--gm-radius-sm)', padding: '11px 0', fontSize: 14, fontWeight: 500 },
  disableBox: { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--gm-line)' },
  codeGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 },
  recoveryCode: { fontFamily: 'monospace', fontSize: 14, background: 'var(--gm-line-soft)', padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', textAlign: 'center' },
};
