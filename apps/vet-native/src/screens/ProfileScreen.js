import { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../AuthContext.js';
import { apiFetch } from '../api/client.js';
import { fetchMyVetProfile, saveVetProfile } from '../api/vetsApi.js';
import { registerForPushNotifications } from '../push.js';
import { colors } from '../theme.js';

const AU_STATES = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

function StatePicker({ value, onChange }) {
  return (
    <View style={styles.stateRow}>
      {AU_STATES.map((s) => (
        <TouchableOpacity activeOpacity={0.7}
          key={s}
          onPress={() => onChange(s)}
          style={[styles.stateChip, value === s && styles.stateChipActive]}
        >
          <Text style={[styles.stateChipText, value === s && styles.stateChipTextActive]}>{s}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [pushStatus, setPushStatus] = useState('idle');
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '' });
  const [pwStatus, setPwStatus] = useState('idle');
  const [pwError, setPwError] = useState('');

  const [vet, setVet] = useState(null);
  const [bankDetails, setBankDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetchMyVetProfile()
      .then((data) => { setVet(data.vet); setBankDetails(data.bankDetails); })
      .catch(() => setVet(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

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
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.name}>{user?.fullName}</Text>
      <Text style={styles.email}>{user?.email}</Text>
      {vet && !vet.is_active && (
        <Text style={styles.pendingBanner}>Your application is pending approval — an admin will activate your account soon.</Text>
      )}

      {!loading && vet && (
        <>
          <PersonalDetailsCard vetId={vet.id} initial={vet} onSaved={load} />
          <RegistrationCard vetId={vet.id} initial={vet} onSaved={load} />
          <TerritoryCard vetId={vet.id} initial={vet} onSaved={load} />
          <BankDetailsCard vetId={vet.id} bankDetails={bankDetails} onSaved={load} />
        </>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Notifications</Text>
        <Text style={styles.cardBody}>Get notified the moment a job is offered to you, even when the app is closed.</Text>
        {pushStatus === 'on' ? (
          <Text style={styles.onNote}>Push notifications are on.</Text>
        ) : (
          <TouchableOpacity activeOpacity={0.7} onPress={onEnablePush} disabled={pushStatus === 'enabling'} style={styles.btn}>
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
        <TouchableOpacity activeOpacity={0.7} onPress={onChangePassword} disabled={pwStatus === 'saving'} style={styles.btn}>
          <Text style={styles.btnText}>{pwStatus === 'saving' ? 'Saving…' : pwStatus === 'saved' ? 'Saved' : 'Change password'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity activeOpacity={0.7} onPress={logout} style={styles.logoutBtn}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function PersonalDetailsCard({ vetId, initial, onSaved }) {
  const [form, setForm] = useState({
    phone: initial.phone || '',
    address: initial.address || '',
    suburb: initial.suburb || '',
    postcode: initial.postcode || '',
    state: initial.state || 'VIC',
  });
  const [status, setStatus] = useState('idle');
  const set = (f) => (v) => { setForm((s) => ({ ...s, [f]: v })); setStatus('idle'); };

  const onSave = async () => {
    setStatus('saving');
    const res = await saveVetProfile(vetId, form);
    setStatus(res.ok ? 'saved' : 'error');
    if (res.ok) onSaved();
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Personal details</Text>
      <Text style={styles.label}>Phone</Text>
      <TextInput value={form.phone} onChangeText={set('phone')} style={styles.input} />
      <Text style={styles.label}>Address</Text>
      <TextInput value={form.address} onChangeText={set('address')} style={styles.input} />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Suburb</Text>
          <TextInput value={form.suburb} onChangeText={set('suburb')} style={styles.input} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Postcode</Text>
          <TextInput value={form.postcode} onChangeText={set('postcode')} keyboardType="numeric" style={styles.input} />
        </View>
      </View>
      <Text style={styles.label}>State</Text>
      <StatePicker value={form.state} onChange={set('state')} />
      <TouchableOpacity activeOpacity={0.7} onPress={onSave} disabled={status === 'saving'} style={styles.btn}>
        <Text style={styles.btnText}>{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function RegistrationCard({ vetId, initial, onSaved }) {
  const [form, setForm] = useState({
    regNumber: initial.reg_number || '',
    regState: initial.reg_state || 'VIC',
    abn: initial.abn || '',
    isGstRegistered: initial.is_gst_registered || false,
  });
  const [status, setStatus] = useState('idle');
  const set = (f) => (v) => { setForm((s) => ({ ...s, [f]: v })); setStatus('idle'); };

  const onSave = async () => {
    setStatus('saving');
    const res = await saveVetProfile(vetId, form);
    setStatus(res.ok ? 'saved' : 'error');
    if (res.ok) onSaved();
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Registration & ABN</Text>
      <Text style={styles.label}>Registration number</Text>
      <TextInput value={form.regNumber} onChangeText={set('regNumber')} style={styles.input} />
      <Text style={styles.label}>Registration state</Text>
      <StatePicker value={form.regState} onChange={set('regState')} />
      <Text style={styles.label}>ABN</Text>
      <TextInput value={form.abn} onChangeText={set('abn')} keyboardType="numeric" style={styles.input} />
      <TouchableOpacity activeOpacity={0.7}
        onPress={() => set('isGstRegistered')(!form.isGstRegistered)}
        style={styles.checkboxRow}
      >
        <View style={[styles.checkbox, form.isGstRegistered && styles.checkboxChecked]} />
        <Text style={styles.checkboxLabel}>Registered for GST</Text>
      </TouchableOpacity>
      <TouchableOpacity activeOpacity={0.7} onPress={onSave} disabled={status === 'saving'} style={styles.btn}>
        <Text style={styles.btnText}>{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function TerritoryCard({ vetId, initial, onSaved }) {
  const [postcodesInput, setPostcodesInput] = useState((initial.postcodes || []).join(', '));
  const [status, setStatus] = useState('idle');

  const onSave = async () => {
    setStatus('saving');
    const postcodes = postcodesInput.split(',').map((p) => p.trim()).filter(Boolean);
    const res = await saveVetProfile(vetId, { postcodes });
    setStatus(res.ok ? 'saved' : 'error');
    if (res.ok) onSaved();
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Territory</Text>
      <Text style={styles.cardBody}>
        Postcodes you cover, as a quick fallback list. For an exact coverage area drawn on a map, ask admin to set your territory in the admin dashboard.
      </Text>
      <Text style={styles.label}>Postcodes (comma-separated)</Text>
      <TextInput
        value={postcodesInput}
        onChangeText={(t) => { setPostcodesInput(t); setStatus('idle'); }}
        placeholder="3121, 3122, 3123…"
        style={styles.input}
      />
      <TouchableOpacity activeOpacity={0.7} onPress={onSave} disabled={status === 'saving'} style={styles.btn}>
        <Text style={styles.btnText}>{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function BankDetailsCard({ vetId, bankDetails, onSaved }) {
  const [form, setForm] = useState({ bankAccountName: '', bankBsb: '', bankAccountNumber: '' });
  const [status, setStatus] = useState('idle');
  const set = (f) => (v) => { setForm((s) => ({ ...s, [f]: v })); setStatus('idle'); };

  const onSave = async () => {
    setStatus('saving');
    const res = await saveVetProfile(vetId, form);
    if (res.ok) {
      setForm({ bankAccountName: '', bankBsb: '', bankAccountNumber: '' });
      setStatus('saved');
      onSaved();
    } else {
      setStatus('error');
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Bank details (for payouts)</Text>
      {bankDetails?.hasBankDetails ? (
        <Text style={styles.cardBody}>
          On file: {bankDetails.accountName || 'account'} · BSB {bankDetails.bsb} · Acc {bankDetails.accountNumber}
        </Text>
      ) : (
        <Text style={styles.cardBody}>No bank details on file yet.</Text>
      )}
      <Text style={styles.label}>Account name</Text>
      <TextInput value={form.bankAccountName} onChangeText={set('bankAccountName')} placeholder="Leave blank to keep current" style={styles.input} />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>BSB</Text>
          <TextInput value={form.bankBsb} onChangeText={set('bankBsb')} placeholder="123-456" keyboardType="numeric" style={styles.input} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Account number</Text>
          <TextInput value={form.bankAccountNumber} onChangeText={set('bankAccountNumber')} placeholder="12345678" keyboardType="numeric" style={styles.input} />
        </View>
      </View>
      <TouchableOpacity activeOpacity={0.7} onPress={onSave} disabled={status === 'saving'} style={styles.btn}>
        <Text style={styles.btnText}>{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Updated' : 'Update bank details'}</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>Encrypted before storage — only masked digits are ever shown again, including to admin.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', color: colors.forestDark },
  name: { fontSize: 17, fontWeight: '700', color: colors.ink, marginTop: 12 },
  email: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  pendingBanner: { fontSize: 13, color: '#7A5A22', backgroundColor: colors.honeySoft, borderRadius: 6, padding: 10, marginTop: 14, overflow: 'hidden' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 16, marginTop: 18 },
  cardTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.inkSoft, marginBottom: 8, fontWeight: '600' },
  cardBody: { fontSize: 13, color: colors.inkSoft, marginBottom: 12 },
  onNote: { fontSize: 14, color: colors.forestDark },
  errorNote: { fontSize: 13, color: colors.brick, marginBottom: 10 },
  label: { fontSize: 12, color: colors.inkSoft, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 11, fontSize: 15 },
  row: { flexDirection: 'row', gap: 12 },
  btn: { minHeight: 44, justifyContent: 'center', backgroundColor: colors.forest, borderRadius: 6, padding: 11, alignItems: 'center', marginTop: 14 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  logoutBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 13, alignItems: 'center', marginTop: 24, marginBottom: 8, backgroundColor: '#fff' },
  logoutText: { color: colors.brick, fontSize: 14, fontWeight: '600' },
  stateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  stateChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.lineSoft },
  stateChipActive: { backgroundColor: colors.forest, borderColor: colors.forest },
  stateChipText: { fontSize: 12, fontWeight: '600', color: colors.inkSoft },
  stateChipTextActive: { color: '#fff' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.line },
  checkboxChecked: { backgroundColor: colors.forest, borderColor: colors.forest },
  checkboxLabel: { fontSize: 13, color: colors.inkSoft },
  hint: { fontSize: 11, color: colors.inkSoft, marginTop: 10, fontStyle: 'italic' },
});
