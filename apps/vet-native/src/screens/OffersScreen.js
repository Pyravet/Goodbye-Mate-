import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
  StyleSheet, Alert, RefreshControl,
} from 'react-native';
import { colors } from '../theme.js';
import { fetchMyOffers, acceptOffer, declineOffer, proposeTime } from '../api/jobsApi.js';

const SERVICE_LABELS = {
  euthanasia_only: 'Euthanasia',
  private_cremation: 'Euthanasia + private cremation',
  communal_cremation: 'Euthanasia + communal cremation',
};

function formatDay(dateStr) {
  return new Date(`${String(dateStr).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function formatTime(t) {
  const [h, m] = String(t || '').split(':');
  const hour = Number(h);
  const suffix = hour >= 12 ? 'pm' : 'am';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${m}${suffix}`;
}

function timeLeft(expiresAt) {
  if (!expiresAt) return null;
  const mins = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000);
  if (mins <= 0) return 'Expired';
  if (mins < 60) return `${mins} min left to respond`;
  return `${Math.round(mins / 60)}h left to respond`;
}

/**
 * Job offers.
 *
 * The native app had NO offers screen at all, so a vet on their phone
 * could not accept work — the entire multi-vet offer flow was
 * unreachable. This is the parity gap that mattered most.
 *
 * Client name, phone and street address are deliberately absent: the
 * server withholds them until a vet accepts.
 */
export default function OffersScreen() {
  const [offers, setOffers] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [proposingId, setProposingId] = useState(null);

  const load = useCallback(() => {
    fetchMyOffers()
      .then(setOffers)
      .catch((err) => { setError(err.message); setOffers([]); });
  }, []);

  useEffect(() => {
    load();
    // Offers expire, and another vet accepting removes them. Without
    // this a vet could tap Accept on an offer that's already gone.
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
    setRefreshing(false);
  };

  const act = async (id, fn, label) => {
    setBusyId(id);
    setError('');
    try {
      await fn(id);
      load();
    } catch (err) {
      // Alert rather than inline text: the offer may have vanished from
      // the list by the time this resolves, taking any inline message
      // with it.
      Alert.alert(label, err.message);
      load();
    } finally {
      setBusyId(null);
    }
  };

  const confirmDecline = (id) => {
    Alert.alert(
      'Decline this job?',
      "It'll be offered to another vet, and you won't be able to take it back.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Decline', style: 'destructive', onPress: () => act(id, declineOffer, 'Could not decline') },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.forest} />}
    >
      <Text style={styles.heading}>Job offers</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {offers === null ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.forest} />
      ) : offers.length === 0 ? (
        <Text style={styles.empty}>
          No offers right now. You&apos;ll get a notification when a job is offered to you.
        </Text>
      ) : (
        offers.map((o) => (
          <View key={o.offer_id} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.petName}>{o.pet_name}</Text>
                <Text style={styles.meta}>
                  {[o.pet_type, o.pet_breed, o.pet_weight].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {o.outcome === 'proposed' && (
                <View style={styles.pill}><Text style={styles.pillText}>Time suggested</Text></View>
              )}
            </View>

            <View style={styles.detail}>
              <Row label="When" value={`${formatDay(o.job_date)} at ${formatTime(o.job_time)}`} />
              <Row label="Where" value={[o.suburb, o.state, o.postcode].filter(Boolean).join(' ')} />
              <Row label="Service" value={SERVICE_LABELS[o.service_type] || o.service_type} />
              {o.notes ? <Row label="Notes" value={o.notes} /> : null}
              {o.payout != null && (
                <Row label="You'd earn" value={`$${Number(o.payout).toFixed(2)}`} strong />
              )}
            </View>

            {o.outcome === 'proposed' ? (
              <Text style={styles.proposedNote}>
                You suggested {formatDay(o.proposed_date)} at {formatTime(String(o.proposed_time).slice(0, 5))}.
                We&apos;ll check with the client and come back to you — the offer stays open meanwhile.
              </Text>
            ) : (
              <>
                {o.expires_at ? <Text style={styles.expiry}>{timeLeft(o.expires_at)}</Text> : null}

                {proposingId === o.id ? (
                  <ProposeForm
                    jobId={o.id}
                    onCancel={() => setProposingId(null)}
                    onDone={() => { setProposingId(null); load(); }}
                  />
                ) : (
                  <>
                    <View style={styles.actions}>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => confirmDecline(o.id)}
                        disabled={busyId === o.id}
                        style={styles.declineBtn}
                      >
                        <Text style={styles.declineText}>Decline</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => act(o.id, acceptOffer, 'Could not accept')}
                        disabled={busyId === o.id}
                        style={styles.acceptBtn}
                      >
                        <Text style={styles.acceptText}>
                          {busyId === o.id ? 'Working…' : 'Accept'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setProposingId(o.id)}
                      style={styles.suggestBtn}
                    >
                      <Text style={styles.suggestText}>Suggest a different time</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}
          </View>
        ))
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

/**
 * Suggest a different time.
 *
 * Plain numeric inputs rather than a native date picker: adding
 * @react-native-community/datetimepicker would mean a native rebuild,
 * which breaks testing in Expo Go — and this screen is the one that most
 * needs to be testable. The fields are validated and the parsed result
 * is echoed back so a typo is visible before sending.
 */
function ProposeForm({ jobId, onCancel, onDone }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Format as the vet types, so they never have to add the separators.
  const onDateChange = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 8);
    if (d.length <= 4) setDate(d);
    else if (d.length <= 6) setDate(`${d.slice(0, 4)}-${d.slice(4)}`);
    else setDate(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`);
  };
  const onTimeChange = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 4);
    setTime(d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`);
  };

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

  const submit = async () => {
    if (!valid) {
      setError('Check the date and time.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await proposeTime(jobId, { date, time, note: note.trim() || null });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <View style={styles.proposeBox}>
      <Text style={styles.proposeHint}>
        A suggestion, not a booking — we&apos;ll check it with the client first.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.pickerLabel}>Date</Text>
      <TextInput
        value={date}
        onChangeText={onDateChange}
        placeholder="YYYY-MM-DD"
        keyboardType="number-pad"
        style={styles.input}
      />

      <Text style={styles.pickerLabel}>Time (24 hour)</Text>
      <TextInput
        value={time}
        onChangeText={onTimeChange}
        placeholder="14:30"
        keyboardType="number-pad"
        style={styles.input}
      />

      {/* Echo the parsed result back. A mistyped date is otherwise
          invisible until admin reads a suggestion for the wrong day. */}
      {valid && (
        <Text style={styles.proposePreview}>
          {formatDay(date)} at {formatTime(time)}
        </Text>
      )}

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Anything to add? (optional)"
        style={styles.input}
      />

      <View style={styles.actions}>
        <TouchableOpacity activeOpacity={0.7} onPress={onCancel} style={styles.declineBtn}>
          <Text style={styles.declineText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={submit}
          disabled={busy || !valid}
          style={[styles.acceptBtn, !valid && styles.disabled]}
        >
          <Text style={styles.acceptText}>{busy ? 'Sending…' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Row({ label, value, strong }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper, padding: 16 },
  heading: { fontSize: 24, fontWeight: '600', color: colors.forestDark, marginBottom: 14 },
  empty: { fontSize: 15, color: colors.inkSoft, lineHeight: 22, marginTop: 8 },
  error: { fontSize: 13, color: colors.brick, marginBottom: 12 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  petName: { fontSize: 20, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  pill: { backgroundColor: colors.honeySoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 11, color: '#7A5A22', fontWeight: '500' },
  detail: { borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 10, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 3 },
  rowLabel: { width: 74, fontSize: 12, color: colors.inkSoft },
  rowValue: { flex: 1, fontSize: 14, color: colors.ink },
  rowValueStrong: { fontWeight: '600', color: colors.forestDark },
  expiry: { fontSize: 12, color: colors.brick, fontWeight: '500', marginBottom: 10 },
  actions: { flexDirection: 'row', gap: 8 },
  // 48px: comfortably past the 44pt HIG minimum, and these are the two
  // buttons that commit a vet to driving somewhere.
  acceptBtn: { flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.forest, borderRadius: 8 },
  acceptText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  declineBtn: { flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8 },
  declineText: { color: colors.inkSoft, fontSize: 16, fontWeight: '500' },
  suggestBtn: { minHeight: 44, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  suggestText: { color: colors.forest, fontSize: 14, textDecorationLine: 'underline' },
  proposedNote: { fontSize: 13, color: '#7A5A22', backgroundColor: colors.honeySoft, padding: 12, borderRadius: 8, lineHeight: 19 },
  proposeBox: { borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 10 },
  proposeHint: { fontSize: 12, color: colors.inkSoft, marginBottom: 10, lineHeight: 17 },
  input: { minHeight: 48, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, fontSize: 16, marginBottom: 10, color: colors.ink },
  disabled: { opacity: 0.5 },
  proposePreview: { fontSize: 13, color: colors.forest, fontWeight: '500', marginBottom: 10 },
  pickerLabel: { fontSize: 11, color: colors.inkSoft },

});
