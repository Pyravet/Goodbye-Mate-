import { useState } from 'react';
import AppShell from '../layout/AppShell.jsx';
import { useAuth } from '../AuthContext.jsx';
import { apiFetch } from '../api.js';
import { enablePushNotifications } from '../push.js';

export default function Profile() {
  const { user, logout } = useAuth();
  const [pushStatus, setPushStatus] = useState('idle'); // idle | enabling | on | error
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '' });
  const [pwStatus, setPwStatus] = useState('idle');
  const [pwError, setPwError] = useState('');

  const onEnablePush = async () => {
    setPushStatus('enabling');
    const result = await enablePushNotifications();
    setPushStatus(result.ok ? 'on' : 'error');
  };

  const onChangePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    setPwStatus('saving');
    try {
      const res = await apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify(pwForm) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to change password');
      }
      setPwStatus('saved');
      setPwForm({ currentPassword: '', newPassword: '' });
    } catch (err) {
      setPwError(err.message);
      setPwStatus('idle');
    }
  };

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Profile</h1>
        <p style={styles.name}>{user?.fullName}</p>
        <p style={styles.email}>{user?.email}</p>

        <div className="gm-card" style={styles.card}>
          <h3 style={styles.cardTitle}>Notifications</h3>
          <p style={styles.cardBody}>Get notified the moment a job is offered to you, even when the app is closed.</p>
          {pushStatus === 'on' ? (
            <p style={styles.onNote}>Push notifications are on.</p>
          ) : (
            <button onClick={onEnablePush} disabled={pushStatus === 'enabling'} style={styles.btn}>
              {pushStatus === 'enabling' ? 'Enabling…' : 'Enable push notifications'}
            </button>
          )}
          {pushStatus === 'error' && <p style={styles.errorNote}>Couldn't enable notifications — check your browser's notification permission for this app.</p>}
        </div>

        <div className="gm-card" style={styles.card}>
          <h3 style={styles.cardTitle}>Change password</h3>
          <form onSubmit={onChangePassword}>
            {pwError && <p style={styles.errorNote}>{pwError}</p>}
            <label style={styles.label}>
              Current password
              <input type="password" value={pwForm.currentPassword} onChange={(e) => setPwForm((f) => ({ ...f, currentPassword: e.target.value }))} required style={styles.input} />
            </label>
            <label style={styles.label}>
              New password
              <input type="password" value={pwForm.newPassword} onChange={(e) => setPwForm((f) => ({ ...f, newPassword: e.target.value }))} required minLength={8} style={styles.input} />
            </label>
            <button type="submit" disabled={pwStatus === 'saving'} style={styles.btn}>
              {pwStatus === 'saving' ? 'Saving…' : pwStatus === 'saved' ? 'Saved' : 'Change password'}
            </button>
          </form>
        </div>

        <button onClick={logout} style={styles.logoutBtn}>Log out</button>
      </div>
    </AppShell>
  );
}

const styles = {
  page: { padding: '20px 16px' },
  title: { fontSize: 22, marginBottom: 4 },
  name: { fontFamily: 'var(--gm-font-display)', fontSize: 17, fontWeight: 600, marginTop: 12 },
  email: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 2 },
  card: { padding: 16, marginTop: 18 },
  cardTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginBottom: 8, fontFamily: 'var(--gm-font-body)', fontWeight: 600 },
  cardBody: { fontSize: 13, color: 'var(--gm-ink-soft)', marginBottom: 12 },
  onNote: { fontSize: 14, color: 'var(--gm-forest-dark)' },
  errorNote: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 10 },
  btn: { padding: '10px 16px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 14, fontWeight: 500 },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 12 },
  input: { display: 'block', width: '100%', marginTop: 6, padding: '10px 11px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 15 },
  logoutBtn: { width: '100%', marginTop: 24, padding: '12px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', background: '#fff', color: 'var(--gm-brick)', fontSize: 14, fontWeight: 500 },
};
