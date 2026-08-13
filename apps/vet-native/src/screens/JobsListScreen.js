import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchMyJobs, acceptOffer, declineOffer } from '../api/jobsApi.js';
import { colors } from '../theme.js';

function formatTime(t) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${period}`;
}

export default function JobsListScreen({ navigation }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchMyJobs('board');
      setJobs(data);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const offers = jobs.filter((j) => j.dispatch_state === 'offered');
  const assigned = jobs.filter((j) => j.assigned_vet_id && j.status !== 'completed' && j.status !== 'cancelled');

  const onAccept = async (id) => { setBusyId(id); try { await acceptOffer(id); load(); } finally { setBusyId(null); } };
  const onDecline = async (id) => { setBusyId(id); try { await declineOffer(id); load(); } finally { setBusyId(null); } };

  const sections = [
    ...(offers.length ? [{ title: 'New offers', data: offers, isOffer: true }] : []),
    { title: 'Upcoming', data: assigned, isOffer: false },
  ];

  return (
    <FlatList
      style={styles.wrap}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.forest} />}
      data={sections}
      keyExtractor={(s) => s.title}
      ListHeaderComponent={<Text style={styles.title}>Your jobs</Text>}
      ListEmptyComponent={!loading ? <Text style={styles.empty}>Nothing here yet.</Text> : null}
      renderItem={({ item: section }) => (
        <View style={{ marginBottom: 20 }}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.data.length === 0 && <Text style={styles.empty}>Nothing right now.</Text>}
          {section.data.map((job) => (
            <View key={job.id} style={styles.card}>
              <TouchableOpacity
                style={styles.cardMain}
                onPress={() => navigation.navigate('JobDetail', { id: job.id })}
              >
                <Text style={styles.petName}>{job.pet_name}</Text>
                <Text style={styles.subline}>
                  {job.suburb || job.postcode} · {formatTime(job.job_time)}
                </Text>
              </TouchableOpacity>
              {section.isOffer && (
                <View style={styles.actions}>
                  <TouchableOpacity onPress={() => onDecline(job.id)} disabled={busyId === job.id} style={styles.declineBtn}>
                    <Text style={styles.declineText}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onAccept(job.id)} disabled={busyId === job.id} style={styles.acceptBtn}>
                    <Text style={styles.acceptText}>Accept</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 16, paddingTop: 20 },
  title: { fontSize: 22, fontWeight: '700', color: colors.forestDark, marginBottom: 16 },
  sectionTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.inkSoft, marginBottom: 8, fontWeight: '600' },
  empty: { color: colors.inkSoft, fontSize: 13 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, marginBottom: 8 },
  cardMain: {},
  petName: { fontSize: 16, fontWeight: '700', color: colors.ink },
  subline: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  declineBtn: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 10, alignItems: 'center' },
  declineText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  acceptBtn: { flex: 1, backgroundColor: colors.forest, borderRadius: 6, padding: 10, alignItems: 'center' },
  acceptText: { fontSize: 14, fontWeight: '600', color: '#fff' },
});
