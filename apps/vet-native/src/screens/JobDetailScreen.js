import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchJob, acceptOffer, declineOffer, markProcedureDone, fetchMedicalNotes, addMedicalNote } from '../api/jobsApi.js';
import Constants from 'expo-constants';
import { Linking, Alert } from 'react-native';
import { getAccessToken } from '../api/client.js';

const API_URL = Constants.expoConfig?.extra?.apiUrl || 'http://localhost:4000/api';
import { colors } from '../theme.js';

export default function JobDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [noteEntries, setNoteEntries] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchJob(id);
      setData(d);
      // Notes load independently — a failure here shouldn't blank the
      // whole job screen the vet needs at the door.
      loadNotes();
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
  const loadNotes = () => fetchMedicalNotes(id).then(setNoteEntries).catch(() => setNoteEntries([]));

  const onAddNote = async () => {
    if (!noteDraft.trim()) return;
    setBusy(true);
    try {
      setNoteEntries(await addMedicalNote(id, noteDraft.trim()));
      setNoteDraft('');
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Open the veterinary record PDF in the device browser. React Native
   * can't download a blob, and the system browser won't carry our auth
   * header, so the short-lived token goes in the query string.
   */
  const openRecord = async () => {
    const token = getAccessToken();
    if (!token) return Alert.alert('Not signed in', 'Please sign in again.');
    const url = `${API_URL}/jobs/${id}/vet-record.pdf?token=${encodeURIComponent(token)}`;
    if (await Linking.canOpenURL(url)) Linking.openURL(url);
    else Alert.alert('Cannot open', 'No app available to open this document.');
  };

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
        {job.admin_notes ? (
          <Card title="📌 Note from admin">
            <Text style={styles.adminNote}>{job.admin_notes}</Text>
          </Card>
        ) : null}

        <Card title="Medical notes">
          {noteEntries === null ? (
            <Text style={styles.subtle}>Loading…</Text>
          ) : noteEntries.length === 0 ? (
            <Text style={styles.subtle}>No notes recorded yet.</Text>
          ) : (
            noteEntries.map((e) => (
              <View key={e.id} style={styles.noteEntry}>
                <Text style={styles.noteMeta}>
                  {new Date(e.created_at).toLocaleString('en-AU', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: 'numeric', minute: '2-digit',
                  })} · {e.author_name}
                </Text>
                <Text style={styles.noteBody}>{e.body}</Text>
              </View>
            ))
          )}

          <TextInput
            value={noteDraft}
            onChangeText={setNoteDraft}
            multiline
            numberOfLines={4}
            placeholder="Add a note — it will be timestamped and attributed to you."
            style={styles.textarea}
          />
          <TouchableOpacity onPress={onAddNote} disabled={busy || !noteDraft.trim()} style={styles.saveBtn}>
            <Text style={styles.saveBtnText}>{busy ? 'Saving…' : 'Add note'}</Text>
          </TouchableOpacity>
          <Text style={styles.noteHint}>
            Notes can't be edited or deleted once added — add a follow-up entry to correct anything.
          </Text>
        </Card>

        <Card title="Veterinary record">
          <Text style={styles.subtle}>
            A formal record of the visit — company and vet registration details, the pet's details and
            the clinical notes. Pet insurers often ask clients for this.
          </Text>
          <TouchableOpacity onPress={openRecord} style={styles.saveBtn}>
            <Text style={styles.saveBtnText}>Open record</Text>
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
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  adminNote: { fontSize: 14, lineHeight: 20, color: colors.ink },
  subtle: { fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  noteEntry: { paddingBottom: 10, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: '#F0EBE0' },
  noteMeta: { fontSize: 11, color: colors.inkSoft, marginBottom: 3 },
  noteBody: { fontSize: 14, lineHeight: 20, color: colors.ink },
  noteHint: { fontSize: 11, color: colors.inkSoft, fontStyle: 'italic', marginTop: 8, lineHeight: 15 },
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
