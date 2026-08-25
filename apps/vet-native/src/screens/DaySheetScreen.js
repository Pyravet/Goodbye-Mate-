import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator,
  StyleSheet, Linking, RefreshControl,
} from 'react-native';
import { colors } from '../theme.js';
import { fetchMyJobs } from '../api/jobsApi.js';

const SERVICE_LABELS = {
  euthanasia_only: 'Euthanasia',
  private_cremation: 'Euthanasia + private cremation',
  communal_cremation: 'Euthanasia + communal cremation',
};

function formatTime(t) {
  const [h, m] = String(t || '').split(':');
  const hour = Number(h);
  const suffix = hour >= 12 ? 'pm' : 'am';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${m}${suffix}`;
}

/**
 * Today, in order.
 *
 * A vet standing at their car at 8am needs "what am I doing next" —
 * address, client's number, and anything unusual about the visit —
 * without tapping into four screens. The jobs list answers a different
 * question ("what do I have on") and buries this one.
 *
 * This is the screen the app opens to.
 */
export default function DaySheetScreen({ navigation }) {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    fetchMyJobs('today')
      .then((all) => {
        // Offers aren't work they hold — those live on the Offers tab.
        // Cancelled jobs are noise on a run sheet.
        const mine = all.filter((j) => !j.isOffer && j.status !== 'cancelled');
        mine.sort((a, b) => String(a.job_time).localeCompare(String(b.job_time)));
        setJobs(mine);
      })
      .catch((err) => { setError(err.message); setJobs([]); });
  }, []);

  useEffect(() => {
    load();
    // A job can be reassigned or cancelled while the vet is out, and a
    // stale run sheet sends someone to the wrong door.
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
    setRefreshing(false);
  };

  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const remaining = (jobs || []).filter((j) => j.status !== 'completed').length;

  return (
    <ScrollView
      style={styles.screen}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.forest} />}
    >
      <Text style={styles.heading}>Today</Text>
      <Text style={styles.date}>
        {today}
        {jobs && jobs.length > 0 ? ` · ${remaining} to go` : ''}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {jobs === null ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.forest} />
      ) : jobs.length === 0 ? (
        <Text style={styles.empty}>Nothing booked today.</Text>
      ) : (
        jobs.map((job, i) => (
          <View key={job.id} style={[styles.card, job.status === 'completed' && styles.cardDone]}>
            <View style={styles.head}>
              <View style={styles.timeBlock}>
                <Text style={styles.time}>{formatTime(job.job_time)}</Text>
                {job.job_time_end ? (
                  <Text style={styles.timeEnd}>to {formatTime(job.job_time_end)}</Text>
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pet}>
                  <Text style={styles.index}>{i + 1}. </Text>{job.pet_name}
                </Text>
                <Text style={styles.meta}>
                  {[job.pet_type, job.pet_breed, job.pet_weight].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {job.status === 'completed' ? (
                <View style={styles.donePill}><Text style={styles.donePillText}>Done</Text></View>
              ) : null}
            </View>

            {/* Admin notes first and prominent. They're instructions
                needed BEFORE arriving — parking, who'll be present, an
                aggressive dog — and below the fold is where they get
                missed. */}
            {job.admin_notes ? (
              <View style={styles.noteBox}>
                <Text style={styles.noteText}>
                  <Text style={styles.noteLabel}>Note: </Text>{job.admin_notes}
                </Text>
              </View>
            ) : null}

            <Text style={styles.service}>
              {SERVICE_LABELS[job.service_type] || job.service_type}
            </Text>

            {/* Readiness at a glance. Arriving to find consent unsigned
                means handling it at the door in front of a grieving
                family — far better to know in the car. */}
            <View style={styles.flags}>
              <Flag ok={job.consent_signed} label="Consent" />
              <Flag ok={job.payment_status === 'paid'} label="Paid" />
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => Linking.openURL(
                  `https://maps.google.com/?q=${encodeURIComponent(job.address || job.suburb || '')}`
                )}
                style={styles.actionBtn}
              >
                <Text style={styles.actionText} numberOfLines={1}>
                  {job.suburb || 'Directions'}
                </Text>
              </TouchableOpacity>

              {job.client_phone ? (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => Linking.openURL(`tel:${job.client_phone}`)}
                  style={styles.actionBtn}
                >
                  <Text style={styles.actionText} numberOfLines={1}>
                    Call {job.client_name ? job.client_name.split(' ')[0] : ''}
                  </Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => navigation.navigate('Jobs', { screen: 'JobDetail', params: { id: job.id } })}
                style={styles.openBtn}
              >
                <Text style={styles.openText}>Open</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function Flag({ ok, label }) {
  return (
    <View style={[styles.flag, ok ? styles.flagOk : styles.flagPending]}>
      <Text style={[styles.flagText, ok ? styles.flagTextOk : styles.flagTextPending]}>
        {ok ? '✓' : '!'} {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper, padding: 16 },
  heading: { fontSize: 26, fontWeight: '600', color: colors.forestDark },
  date: { fontSize: 13, color: colors.inkSoft, marginBottom: 18, marginTop: 2 },
  empty: { fontSize: 15, color: colors.inkSoft },
  error: { fontSize: 13, color: colors.brick, marginBottom: 12 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardDone: { opacity: 0.6 },
  head: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 10 },
  timeBlock: { minWidth: 72 },
  time: { fontSize: 18, fontWeight: '600', color: colors.ink },
  timeEnd: { fontSize: 11, color: colors.inkSoft },
  index: { color: colors.inkSoft, fontWeight: '400' },
  pet: { fontSize: 18, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  donePill: { backgroundColor: '#E3E9E1', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  donePillText: { fontSize: 11, color: colors.forest, fontWeight: '500' },
  noteBox: { backgroundColor: colors.honeySoft, borderRadius: 8, padding: 11, marginBottom: 10 },
  noteText: { fontSize: 13, color: '#7A5A22', lineHeight: 19 },
  noteLabel: { fontWeight: '600' },
  service: { fontSize: 13, color: colors.inkSoft, marginBottom: 8 },
  flags: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  flag: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  flagOk: { backgroundColor: '#E3E9E1' },
  flagPending: { backgroundColor: colors.honeySoft },
  flagText: { fontSize: 11, fontWeight: '500' },
  flagTextOk: { color: colors.forest },
  flagTextPending: { color: '#7A5A22' },
  actions: { flexDirection: 'row', gap: 8 },
  // 44pt minimum per HIG — these get tapped one-handed, often in a car.
  actionBtn: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 6 },
  actionText: { fontSize: 13, fontWeight: '500', color: colors.ink },
  openBtn: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.forest, borderRadius: 8 },
  openText: { fontSize: 13, fontWeight: '500', color: '#fff' },
});
