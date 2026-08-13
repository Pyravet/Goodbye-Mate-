import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../AuthContext.js';
import { apiFetch } from '../api/client.js';
import { registerForPushNotifications } from '../push.js';
import { colors } from '../theme.js';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [pushStatus, setPushStatus] = useState('idle');
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '' });
  const [pwStatus, setPwStatus] = useState('idle');
  const [pwError, setPwError] = useState('');

  const onEnablePush = async () => {
    setPushStatus('enabling');
    const result = await registerForPushNotifications();
    setPushStatus(result.ok ? 'on' : 'error');
  };

  const onChangePassword = async () => {
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
    <View style={styles.wrap}>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.name}>{user?.fullName}</Text>
      <Text style={styles.email}>{user?.email}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Notifications</Text>
        <Text style={styles.cardBody}>Get notified the moment a job is offered to you, even when the app is closed.</Text>
        {pushStatus === 'on' ? (
          <Text style={styles.onNote}>Push notifications are on.</Text>
        ) : (
          <TouchableOpacity onPress={onEnablePush} disabled={pushStatus === 'enabling'} style={styles.btn}>
            <Text style={styles.btnText}>{pushStatus === 'enabling' ? 'Enabling…' : 'Enable push notifications'}</Text>
          </TouchableOpacity>
        )}
        {pushStatus === 'error' && <Text style={styles.errorNote}>Couldn't enable notifications — check this app's notification permission in system settings.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Change password</Text>
        {pwError ? <Text style={styles.errorNote}>{pwError}</Text> : null}
        <Text style={styles.label}>Current password</Text>
        <TextInput
          value={pwForm.currentPassword}
          onChangeText={(t) => setPwForm((f) => ({ ...f, currentPassword: t }))}
          secureTextEntry
          style={styles.input}
        />
        <Text style={styles.label}>New password</Text>
        <TextInput
          value={pwForm.newPassword}
          onChangeText={(t) => setPwForm((f) => ({ ...f, newPassword: t }))}
          secureTextEntry
          style={styles.input}
        />
        <TouchableOpacity onPress={onChangePassword} disabled={pwStatus === 'saving'} style={styles.btn}>
          <Text style={styles.btnText}>{pwStatus === 'saving' ? 'Saving…' : pwStatus === 'saved' ? 'Saved' : 'Change password'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.paper, padding: 16 },
  title: { fontSize: 22, fontWeight: '700', color: colors.forestDark },
  name: { fontSize: 17, fontWeight: '700', color: colors.ink, marginTop: 12 },
  email: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 16, marginTop: 18 },
  cardTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.inkSoft, marginBottom: 8, fontWeight: '600' },
  cardBody: { fontSize: 13, color: colors.inkSoft, marginBottom: 12 },
  onNote: { fontSize: 14, color: colors.forestDark },
  errorNote: { fontSize: 13, color: colors.brick, marginBottom: 10 },
  label: { fontSize: 12, color: colors.inkSoft, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 11, fontSize: 15 },
  btn: { backgroundColor: colors.forest, borderRadius: 6, padding: 11, alignItems: 'center', marginTop: 12 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  logoutBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 13, alignItems: 'center', marginTop: 24, backgroundColor: '#fff' },
  logoutText: { color: colors.brick, fontSize: 14, fontWeight: '600' },
});
