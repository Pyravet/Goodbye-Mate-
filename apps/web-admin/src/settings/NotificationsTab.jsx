import { useEffect, useState } from 'react';
import { enablePushNotifications, getPushSubscriptionStatus } from '../push.js';

export default function NotificationsTab() {
  const [status, setStatus] = useState('checking'); // checking | on | off | enabling | error | unsupported
  const [errorReason, setErrorReason] = useState('');

  useEffect(() => {
    getPushSubscriptionStatus().then(setStatus);
  }, []);

  const onEnable = async () => {
    setStatus('enabling');
    setErrorReason('');
    const result = await enablePushNotifications();
    if (result.ok) {
      setStatus('on');
    } else {
      setStatus('error');
      setErrorReason(result.reason);
    }
  };

  return (
    <div style={styles.wrap}>
      <h3 style={styles.title}>Push notifications</h3>
      <p style={styles.body}>
        Get a popup notification on this device the moment something needs attention — for example, when a vet marks
        themselves as on the way to a job.
      </p>

      {status === 'checking' && <p style={styles.muted}>Checking status…</p>}

      {status === 'on' && <p style={styles.onNote}>Notifications are on for this browser.</p>}

      {(status === 'off' || status === 'error') && (
        <>
          <button onClick={onEnable} disabled={status === 'enabling'} style={styles.btn}>
            Enable notifications
          </button>
          {status === 'error' && (
            <p style={styles.errorNote}>
              {errorReason === 'denied'
                ? "Notification permission was denied — enable it in this browser's site settings and try again."
                : errorReason === 'not_configured'
                ? 'Notifications are not configured on this deployment yet.'
                : "Couldn't enable notifications — try again."}
            </p>
          )}
        </>
      )}

      {status === 'unsupported' && <p style={styles.muted}>This browser doesn't support push notifications.</p>}

      <p style={styles.hint}>This is per-browser — enable it on every device/browser you want alerts on.</p>
    </div>
  );
}

const styles = {
  wrap: { maxWidth: 480 },
  title: { fontSize: 16, marginBottom: 10 },
  body: { fontSize: 13, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 16 },
  muted: { fontSize: 13, color: 'var(--gm-ink-soft)' },
  onNote: { fontSize: 14, color: 'var(--gm-forest-dark)' },
  btn: { padding: '10px 18px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 14, fontWeight: 500 },
  errorNote: { fontSize: 12, color: 'var(--gm-brick)', marginTop: 10 },
  hint: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 16, fontStyle: 'italic' },
};
