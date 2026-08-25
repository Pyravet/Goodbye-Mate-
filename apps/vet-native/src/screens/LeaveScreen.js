import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import { colors } from '../theme.js';
import { fetchMyVetProfile } from '../api/vetsApi.js';
import { fetchLeave, addLeave, removeLeave } from '../api/vetsApi.js';

function fmt(d) {
  return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/**
 * Time away.
 *
 * Availability existed only as weekly hours and per-day toggles, so
 * booking a fortnight off meant ticking fourteen days — which nobody
 * does. Dispatch then kept offering jobs the vet couldn't take, and
 * every lapsed offer counted against their reliability record. They were
 * being penalised for the system not knowing they were away.
 */
export default function LeaveScreen() {
  const [vetId, setVetId] = useState(null);
  const [leave, setLeave] = useState(null);
  const [form, setForm] = useState({ startsOn: '', endsOn: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback((id) => {
    fetchLeave(id).then(setLeave).catch(() => setLeave([]));
  }, []);

  useEffect(() => {
    fetchMyVetProfile()
      .then((v) => { setVetId(v.id); load(v.id); })
      .catch((err) => { setError(err.message); setLeave([]); });
  }, [load]);

  // Auto-format so the separators never have to be typed on a phone.
  const onDate = (key) => (v) => {
    const d = v.replace(/\D/g, '').slice(0, 8);
    const out = d.length <= 4 ? d
      : d.length <= 6 ? `${d.slice(0, 4)}-${d.slice(4)}`
      : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
    setForm((f) => ({ ...f, [key]: out }));
  };

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(form.startsOn)
    && /^\d{4}-\d{2}-\d{2}$/.test(form.endsOn)
    && form.endsOn >= form.startsOn;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await addLeave(vetId, form);
      // Jobs already accepted in the period are surfaced, NOT cancelled.
      // Someone has to decide what happens to each, and silently
      // dropping a commitment a client expects would be far worse.
      if (result.clashingJobs?.length) {
        Alert.alert(
          'You have jobs booked in that period',
          `${result.clashingJobs.length} job(s) fall inside these dates. They have NOT been cancelled — `
          + 'please let the office know so they can be reassigned.'
        );
      }
      setForm({ startsOn: '', endsOn: '', reason: '' });
      load(vetId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = (id) => {
    Alert.alert(
      'Remove this leave?',
      'You may start receiving job offers for those dates again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeLeave(vetId, id);
              load(vetId);
            } catch (err) {
              Alert.alert('Could not remove', err.message);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.heading}>Time off</Text>
      <Text style={styles.hint}>
        Dates you&apos;re away. You won&apos;t be offered jobs on these days, and they won&apos;t
        count against your response record.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {leave === null ? (
        <ActivityIndicator color={colors.forest} style={{ marginTop: 16 }} />
      ) : leave.length === 0 ? (
        <Text style={styles.empty}>No leave booked.</Text>
      ) : (
        leave.map((l) => (
          <View key={l.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dates}>{fmt(l.starts_on)} – {fmt(l.ends_on)}</Text>
              {l.reason ? <Text style={styles.reason}>{l.reason}</Text> : null}
            </View>
            <TouchableOpacity activeOpacity={0.7} onPress={() => remove(l.id)} style={styles.removeBtn}>
              <Text style={styles.removeText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <View style={styles.form}>
        <Text style={styles.formTitle}>Book time off</Text>

        <Text style={styles.label}>From</Text>
        <TextInput
          value={form.startsOn}
          onChangeText={onDate('startsOn')}
          placeholder="YYYY-MM-DD"
          keyboardType="number-pad"
          style={styles.input}
        />

        <Text style={styles.label}>To (inclusive)</Text>
        <TextInput
          value={form.endsOn}
          onChangeText={onDate('endsOn')}
          placeholder="YYYY-MM-DD"
          keyboardType="number-pad"
          style={styles.input}
        />

        {/* Echo it back so a typo is visible before saving, rather than
            discovering it when offers stop arriving. */}
        {valid ? (
          <Text style={styles.preview}>
            Away {fmt(form.startsOn)} – {fmt(form.endsOn)}
          </Text>
        ) : null}
        {form.startsOn && form.endsOn && !valid ? (
          <Text style={styles.error}>Check the dates — the end must not be before the start.</Text>
        ) : null}

        <Text style={styles.label}>Reason (optional)</Text>
        <TextInput
          value={form.reason}
          onChangeText={(v) => setForm((f) => ({ ...f, reason: v }))}
          placeholder="e.g. Annual leave"
          style={styles.input}
        />

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={save}
          disabled={busy || !valid || !vetId}
          style={[styles.saveBtn, (!valid || busy) && styles.disabled]}
        >
          <Text style={styles.saveText}>{busy ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper, padding: 16 },
  heading: { fontSize: 24, fontWeight: '600', color: colors.forestDark, marginBottom: 6 },
  hint: { fontSize: 13, color: colors.inkSoft, lineHeight: 20, marginBottom: 16 },
  empty: { fontSize: 14, color: colors.inkSoft, marginBottom: 8 },
  error: { fontSize: 13, color: colors.brick, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, marginBottom: 8 },
  dates: { fontSize: 15, fontWeight: '500', color: colors.ink },
  reason: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  removeBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  removeText: { color: colors.brick, fontSize: 13, textDecorationLine: 'underline' },
  form: { marginTop: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 16 },
  formTitle: { fontSize: 16, fontWeight: '600', color: colors.ink, marginBottom: 12 },
  label: { fontSize: 12, color: colors.inkSoft, marginBottom: 4 },
  input: { minHeight: 48, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, fontSize: 16, marginBottom: 12, color: colors.ink },
  preview: { fontSize: 13, color: colors.forest, fontWeight: '500', marginBottom: 12 },
  saveBtn: { minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.forest, borderRadius: 8 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  disabled: { opacity: 0.5 },
});
