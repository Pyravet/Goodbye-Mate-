import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchJob, acceptOffer, declineOffer, markProcedureDone, saveMedicalNotes } from '../api/jobsApi.js';
import { colors } from '../theme.js';

export default function JobDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchJob(id);
      setData(d);
      setNotes(d.job.medical_notes || '');
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onAccept = async () => { setBusy(true); try { await acceptOffer(id); load(); } finally { setBusy(false); } };
  const onDecline = async () => { setBusy(true); try { await declineOffer(id); navigation.goBack(); } finally { setBusy(false); } };
  const onProcedureDone = async () => { setBusy(true); try { await markProcedureDone(id); load(); } finally { setBusy(false); } };
  const onSaveNotes = async () => { setBusy(true); try { await saveMedicalNotes(id, notes); setNotesSaved(true); } finally { setBusy(false); } };

  if (loading) return <View style={styles.wrap}><Text style={styles.loading}>Loading…</Text></View>;
  if (!data) return <View style={styles.wrap}><Text style={styles.loading}>Job not found.</Text></View>;

  const { job } = data;
  const isOffer = job.dispatch_state === 'offered';

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{job.pet_name}</Text>
      <Text style={styles.subtitle}>
        {job.job_number} · {new Date(job.job_date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })} at {job.job_time}
      </Text>
      {job.pet_behaviour && job.pet_behaviour !== 'Friendly' && (
        <View style={styles.badge}><Text style={styles.badgeText}>{job.pet_behaviour}</Text></View>
      )}

      {isOffer && (
        <View style={styles.offerBar}>
          <TouchableOpacity onPress={onDecline} disabled={busy} style={styles.declineBtn}>
            <Text style={styles.declineText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onAccept} disabled={busy} style={styles.acceptBtn}>
            <Text style={styles.acceptText}>Accept offer</Text>
          </TouchableOpacity>
        </View>
      )}

      <Card title="Client">
        <Text style={styles.plain}>{job.client_name}</Text>
        <TouchableOpacity onPress={() => Linking.openURL(`tel:${job.client_phone}`)}>
          <Text style={styles.linkText}>{job.client_phone}</Text>
        </TouchableOpacity>
      </Card>

      <Card title="Address">
        <Text style={styles.plain}>{job.address}</Text>
        {job.notes ? <Text style={styles.notes}>{job.notes}</Text> : null}
        <TouchableOpacity
          onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}`)}
        >
          <Text style={styles.linkText}>Get directions →</Text>
        </TouchableOpacity>
      </Card>

      <Card title="Pet">
        <Text style={styles.plain}>{job.pet_type}{job.pet_breed ? `, ${job.pet_breed}` : ''}</Text>
        <Text style={styles.subline2}>{[job.pet_weight, job.pet_age].filter(Boolean).join(' · ')}</Text>
      </Card>

      {!isOffer && (
        <Card title="Procedure">
          {job.procedure_done ? (
            <Text style={styles.doneNote}>Marked as completed.</Text>
          ) : (
            <TouchableOpacity onPress={onProcedureDone} disabled={busy} style={styles.doneBtn}>
              <Text style={styles.acceptText}>Mark procedure done</Text>
            </TouchableOpacity>
          )}
        </Card>
      )}

      {!isOffer && (
        <Card title="Medical notes">
          <TextInput
            value={notes}
            onChangeText={(t) => { setNotes(t); setNotesSaved(false); }}
            multiline
            numberOfLines={5}
            placeholder="Private notes — never shown to the client automatically."
            style={styles.textarea}
          />
          <TouchableOpacity onPress={onSaveNotes} disabled={busy || notesSaved} style={styles.saveBtn}>
            <Text style={styles.acceptText}>{notesSaved ? 'Saved' : busy ? 'Saving…' : 'Save notes'}</Text>
          </TouchableOpacity>
        </Card>
      )}
    </ScrollView>
  );
}

function Card({ title, children }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 16, paddingBottom: 40 },
  loading: { padding: 20, color: colors.inkSoft },
  title: { fontSize: 24, fontWeight: '700', color: colors.forestDark, marginTop: 6 },
  subtitle: { fontSize: 13, color: colors.inkSoft, marginTop: 4 },
  badge: { backgroundColor: colors.honeySoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start', marginTop: 8 },
  badgeText: { fontSize: 12, color: '#7A5A22', fontWeight: '600' },
  offerBar: { flexDirection: 'row', gap: 8, marginTop: 16 },
  declineBtn: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 13, alignItems: 'center', backgroundColor: '#fff' },
  declineText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  acceptBtn: { flex: 1, backgroundColor: colors.forest, borderRadius: 6, padding: 13, alignItems: 'center' },
  acceptText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 16, marginTop: 16 },
  cardTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.inkSoft, marginBottom: 10, fontWeight: '600' },
  plain: { fontSize: 15, color: colors.ink },
  subline2: { fontSize: 13, color: colors.inkSoft, marginTop: 4 },
  notes: { fontSize: 13, color: colors.inkSoft, marginTop: 8, fontStyle: 'italic' },
  linkText: { color: colors.forest, fontSize: 15, fontWeight: '600', marginTop: 6 },
  doneNote: { fontSize: 14, color: colors.forestDark },
  doneBtn: { backgroundColor: colors.forest, borderRadius: 6, padding: 12, alignItems: 'center' },
  textarea: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 12, fontSize: 15, minHeight: 100, textAlignVertical: 'top' },
  saveBtn: { backgroundColor: colors.forest, borderRadius: 6, padding: 10, alignItems: 'center', marginTop: 10 },
});
