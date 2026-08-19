import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet, Linking, Alert,
} from 'react-native';
import Constants from 'expo-constants';
import { colors } from '../theme.js';
import { fetchMyPayoutPeriods } from '../api/payoutsApi.js';
import { fetchMe, fetchEarnings } from '../api/vetsApi.js';
import { getAccessToken } from '../api/client.js';

const API_URL = Constants.expoConfig?.extra?.apiUrl || 'http://localhost:4000/api';

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function weekLabel(startStr) {
  const start = new Date(`${String(startStr).slice(0, 10)}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (d) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function EarningsScreen() {
  const [summary, setSummary] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMe()
      .then((me) => fetchEarnings(me.vet.id))
      .then(setSummary)
      .catch(() => setError('Could not load earnings.'));

    // Loaded independently so a failure here doesn't blank the summary.
    fetchMyPayoutPeriods().then(setPeriods).catch(() => setPeriods([]));
  }, []);

  /**
   * Open a period RCTI.
   *
   * React Native can't fetch a PDF into a blob and trigger a download
   * the way a browser can, so the document is opened in the device
   * browser. The access token goes in the query string because the
   * system browser won't carry our Authorization header — the endpoint
   * accepts it either way.
   */
  const openRcti = async (periodId) => {
    const token = getAccessToken();
    if (!token) {
      Alert.alert('Not signed in', 'Please sign in again to open this document.');
      return;
    }
    const url = `${API_URL}/payouts/periods/${periodId}/rcti.pdf?token=${encodeURIComponent(token)}`;
    const supported = await Linking.canOpenURL(url);
    if (supported) Linking.openURL(url);
    else Alert.alert('Cannot open', 'No app available to open this document.');
  };

  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.heading}>Earnings</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {summary === null ? (
        <ActivityIndicator color={colors.forest} />
      ) : (
        <View style={styles.grid}>
          <Stat label="Today" value={summary.today} />
          <Stat label="This week" value={summary.thisWeek} />
          <Stat label="This month" value={summary.thisMonth} />
          <Stat label="All-time" value={summary.allTime} />
        </View>
      )}

      <Text style={styles.section}>Weekly payouts</Text>
      {periods.length === 0 ? (
        <Text style={styles.empty}>
          No payouts issued yet. Once admin approves a week, its RCTI appears here.
        </Text>
      ) : (
        periods.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.weekTitle}>{weekLabel(p.period_start)}</Text>
                <Text style={styles.meta}>
                  {p.rcti_number}
                  {p.status === 'paid' && p.paid_at
                    ? ` · paid ${new Date(p.paid_at).toLocaleDateString('en-AU')}`
                    : ' · awaiting payment'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.total}>{money(p.total)}</Text>
                <View style={[styles.pill, p.status === 'paid' ? styles.pillPaid : styles.pillApproved]}>
                  <Text style={styles.pillText}>{p.status}</Text>
                </View>
              </View>
            </View>

            {Number(p.gst) > 0 && (
              <Text style={styles.meta}>
                Subtotal {money(p.subtotal)} · GST {money(p.gst)}
              </Text>
            )}

            <TouchableOpacity onPress={() => openRcti(p.id)} style={styles.outlineBtn}>
              <Text style={styles.outlineBtnText}>View RCTI</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{money(value)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper, padding: 16 },
  heading: { fontSize: 22, fontWeight: '600', color: colors.forestDark, marginBottom: 14 },
  error: { color: colors.brick, fontSize: 13, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { width: '47%', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14 },
  statValue: { fontSize: 19, fontWeight: '600', color: colors.forestDark },
  statLabel: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  section: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.inkSoft, fontWeight: '600', marginTop: 24, marginBottom: 10 },
  empty: { color: colors.inkSoft, fontSize: 13 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  weekTitle: { fontSize: 15, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 11, color: colors.inkSoft, marginTop: 3 },
  total: { fontSize: 17, fontWeight: '600', color: colors.forestDark },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  pillPaid: { backgroundColor: '#E3E9E1' },
  pillApproved: { backgroundColor: '#F3E6CB' },
  pillText: { fontSize: 11, color: colors.forestDark },
  outlineBtn: { borderWidth: 1, borderColor: colors.forest, borderRadius: 8, paddingVertical: 9, alignItems: 'center', marginTop: 12 },
  outlineBtnText: { color: colors.forest, fontSize: 13, fontWeight: '500' },
});
