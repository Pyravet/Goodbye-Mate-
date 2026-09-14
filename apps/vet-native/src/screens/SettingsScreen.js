import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import { colors } from '../theme.js';
import {
  fetchMe, fetchNoteTemplates, addNoteTemplate, removeNoteTemplate,
  fetchNotificationPrefs, saveNotificationPrefs,
} from '../api/vetsApi.js';

const PAUSE_OPTIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: 'Until tomorrow', minutes: 12 * 60 },
  { label: 'A week', minutes: 7 * 24 * 60 },
];

/**
 * Notifications and note templates, on the phone.
 *
 * Both were web-only. Vets are in the car between visits — that's
 * exactly when they want to silence the next hour, or write the phrasing
 * they use every time while it's fresh.
 */
export default function SettingsScreen() {
  const [vet, setVet] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [draft, setDraft] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchMe()
      .then((d) => {
        setVet(d.vet);
        return fetchNoteTemplates(d.vet.id);
      })
      .then(setTemplates)
      .catch((err) => { setError(err.message); setTemplates([]); });
    fetchNotificationPrefs().then(setPrefs).catch(() => setPrefs({}));
  }, []);

  useEffect(() => { load(); }, [load]);

  const pause = async (minutes) => {
    setBusy(true);
    try {
      setPrefs(await saveNotificationPrefs({ pauseMinutes: minutes }));
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    if (!draft.title.trim() || !draft.body.trim()) {
      setError('A template needs a name and some text.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await addNoteTemplate(vet.id, draft);
      setDraft({ title: '', body: '' });
      setTemplates(await fetchNoteTemplates(vet.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const pausedUntil = prefs?.notifications_paused_until
    ? new Date(prefs.notifications_paused_until)
    : null;
  const isPaused = pausedUntil && pausedUntil > new Date();

  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.heading}>Notifications</Text>

      {isPaused ? (
        <View style={styles.pausedBox}>
          <Text style={styles.pausedText}>
            Paused until {pausedUntil.toLocaleString('en-AU', {
              weekday: 'short', hour: 'numeric', minute: '2-digit',
            })}.
          </Text>
          {/* Stated explicitly, because a vet who thinks they've silenced
              everything and then misses a cancellation would rightly be
              annoyed — and this is the behaviour that protects them. */}
          <Text style={styles.pausedHint}>
            Reminders and cancellations for jobs you&apos;ve already accepted will still come
            through. Only new offers are held back.
          </Text>
          <TouchableOpacity activeOpacity={0.7} onPress={() => pause(0)} disabled={busy} style={styles.resumeBtn}>
            <Text style={styles.resumeText}>Turn notifications back on</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={styles.hint}>
            Pause new job offers for a while. It switches back on by itself, so you can&apos;t
            leave it off by accident.
          </Text>
          <View style={styles.pauseRow}>
            {PAUSE_OPTIONS.map((o) => (
              <TouchableOpacity
                key={o.minutes}
                activeOpacity={0.7}
                onPress={() => pause(o.minutes)}
                disabled={busy}
                style={styles.pauseBtn}
              >
                <Text style={styles.pauseText}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={styles.heading}>Note templates</Text>
      <Text style={styles.hint}>
        Phrasing you use often, ready to drop into a job&apos;s notes.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {templates === null ? (
        <ActivityIndicator color={colors.forest} style={{ marginVertical: 12 }} />
      ) : templates.length === 0 ? (
        <Text style={styles.hint}>No templates yet.</Text>
      ) : (
        templates.map((t) => (
          <View key={t.id} style={styles.templateRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.templateTitle}>{t.title}</Text>
              <Text style={styles.templateBody} numberOfLines={2}>{t.body}</Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => Alert.alert('Remove template?', t.title, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await removeNoteTemplate(vet.id, t.id);
                      setTemplates(await fetchNoteTemplates(vet.id));
                    } catch (err) { Alert.alert('Could not remove', err.message); }
                  },
                },
              ])}
              style={styles.removeBtn}
            >
              <Text style={styles.removeText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <TextInput
        value={draft.title}
        onChangeText={(v) => setDraft((d) => ({ ...d, title: v }))}
        placeholder="Name, e.g. Standard sedation"
        style={styles.input}
      />
      <TextInput
        value={draft.body}
        onChangeText={(v) => setDraft((d) => ({ ...d, body: v }))}
        placeholder="The text itself"
        multiline
        style={[styles.input, styles.multiline]}
      />
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={saveTemplate}
        disabled={busy || !vet}
        style={styles.saveBtn}
      >
        <Text style={styles.saveText}>{busy ? 'Saving…' : 'Add template'}</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper, padding: 16 },
  heading: { fontSize: 20, fontWeight: '600', color: colors.forestDark, marginTop: 12, marginBottom: 6 },
  hint: { fontSize: 13, color: colors.inkSoft, lineHeight: 19, marginBottom: 12 },
  error: { fontSize: 13, color: colors.brick, marginBottom: 10 },
  pauseRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  pauseBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8 },
  pauseText: { fontSize: 13, color: colors.ink },
  pausedBox: { backgroundColor: colors.honeySoft, borderRadius: 10, padding: 14, marginBottom: 8 },
  pausedText: { fontSize: 15, fontWeight: '600', color: '#7A5A22' },
  pausedHint: { fontSize: 12, color: '#7A5A22', lineHeight: 18, marginTop: 6, marginBottom: 12 },
  resumeBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forest, borderRadius: 8 },
  resumeText: { fontSize: 14, color: '#fff', fontWeight: '500' },
  templateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, marginBottom: 8 },
  templateTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  templateBody: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  removeBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  removeText: { fontSize: 12, color: colors.brick, textDecorationLine: 'underline' },
  input: { minHeight: 44, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, fontSize: 15, color: colors.ink, marginBottom: 8 },
  multiline: { minHeight: 88, paddingTop: 12, textAlignVertical: 'top' },
  saveBtn: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forest, borderRadius: 8 },
  saveText: { fontSize: 15, color: '#fff', fontWeight: '500' },
});
