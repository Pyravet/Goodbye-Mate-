import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import { colors } from '../theme.js';
import { fetchMe, setDateOverride } from '../api/vetsApi.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Is this vet available on this date?
 *
 * Mirrors isVetAvailableOnDate in server/src/domain/dispatch.js. If that
 * rule changes, this must change with it — a vet seeing different
 * availability from the one dispatch acts on is worse than no calendar,
 * because they'd trust it.
 */
function availableOn(vet, dateKey) {
  const o = vet?.date_overrides?.[dateKey];
  if (Array.isArray(o)) return o.length > 0;
  if (o !== undefined) return o;
  const dayKey = DAY_KEYS[new Date(`${dateKey}T00:00:00`).getDay()];
  return Object.values(vet?.weekly_hours?.[dayKey] || {}).some(Boolean);
}

const pad = (h) => `${String(Math.min(h, 23)).padStart(2, '0')}:00`;

/**
 * A vet's own availability.
 *
 * Matters more than it looks: dispatch excludes anyone marked
 * unavailable, so an out-of-date pattern silently costs the vet work and
 * they'd have no idea why the offers stopped.
 */
export default function AvailabilityScreen() {
  const [vet, setVet] = useState(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchMe()
      .then((d) => setVet(d.vet))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const { label, cells } = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const y = base.getFullYear();
    const m = base.getMonth();
    const count = new Date(y, m + 1, 0).getDate();
    const list = [];
    // Blanks so the 1st sits under its real weekday.
    for (let i = 0; i < new Date(y, m, 1).getDay(); i++) list.push(null);
    for (let d = 1; d <= count; d++) {
      // Local parts, not toISOString — that would shift the day east of
      // UTC and mislabel every date.
      list.push({
        key: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        day: d,
      });
    }
    return {
      label: base.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
      cells: list,
    };
  }, [monthOffset]);

  const overrides = vet?.date_overrides || {};
  const todayKey = new Date().toLocaleDateString('en-CA');

  const pick = (key) => {
    const existing = overrides[key];
    let ranges;
    if (Array.isArray(existing)) ranges = existing.map((r) => ({ ...r }));
    else if (existing === false) ranges = [];
    else {
      // Seed from the weekly pattern so it's an edit, not a blank slate.
      const dayKey = DAY_KEYS[new Date(`${key}T00:00:00`).getDay()];
      const hrs = Object.keys(vet?.weekly_hours?.[dayKey] || {})
        .filter((h) => vet.weekly_hours[dayKey][h]).map(Number).sort((a, b) => a - b);
      ranges = hrs.length ? [{ start: pad(hrs[0]), end: pad(hrs[hrs.length - 1] + 1) }] : [];
    }
    setSelected(key);
    setDraft(ranges);
    setError('');
  };

  const save = async (value) => {
    if (Array.isArray(value)) {
      for (const r of value) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.end)) {
          setError('Times need to look like 09:00.');
          return;
        }
        if (r.end <= r.start) {
          setError('A finish time must be after its start time.');
          return;
        }
      }
    }
    setSaving(true);
    setError('');
    try {
      await setDateOverride(vet.id, selected, value);
      setSelected(null);
      load();
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!vet) {
    return (
      <View style={styles.centre}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.forest} />}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.heading}>Your availability</Text>
      <Text style={styles.intro}>
        You&apos;ll only be offered jobs during the hours you&apos;re available. Tap a date to set
        different hours just for that day.
      </Text>

      <View style={styles.monthRow}>
        <TouchableOpacity activeOpacity={0.7} onPress={() => setMonthOffset((m) => m - 1)} style={styles.navBtn}>
          <Text style={styles.navText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{label}</Text>
        <TouchableOpacity activeOpacity={0.7} onPress={() => setMonthOffset((m) => m + 1)} style={styles.navBtn}>
          <Text style={styles.navText}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((d, i) => <Text key={i} style={styles.weekLabel}>{d}</Text>)}
      </View>

      <View style={styles.grid}>
        {cells.map((c, i) => {
          if (!c) return <View key={`b${i}`} style={styles.cell} />;
          const on = availableOn(vet, c.key);
          const isSet = overrides[c.key] !== undefined;
          const past = c.key < todayKey;
          return (
            <TouchableOpacity
              key={c.key}
              activeOpacity={0.7}
              disabled={past}
              onPress={() => pick(c.key)}
              style={[
                styles.cell,
                styles.day,
                on ? styles.dayOn : styles.dayOff,
                selected === c.key && styles.daySelected,
                past && styles.dayPast,
              ]}
            >
              <Text style={on ? styles.dayNumOn : styles.dayNum}>{c.day}</Text>
              {/* A dot marks a date set deliberately, so an exception is
                  distinguishable from the usual weekly pattern. */}
              {isSet && <View style={styles.dot} />}
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.legend}>
        Green means available. A dot means that date has been set specifically. Past dates
        can&apos;t be changed.
      </Text>

      {selected && (
        <View style={styles.editor}>
          <Text style={styles.editorTitle}>
            {new Date(`${selected}T00:00:00`).toLocaleDateString('en-AU', {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {draft.length === 0 && (
            <Text style={styles.hint}>Not working this date. Add hours below to change that.</Text>
          )}

          {draft.map((r, i) => (
            <View key={i} style={styles.rangeRow}>
              <TextInput
                value={r.start}
                onChangeText={(v) => setDraft(draft.map((x, j) => (j === i ? { ...x, start: v } : x)))}
                placeholder="09:00"
                keyboardType="numbers-and-punctuation"
                style={styles.timeInput}
              />
              <Text style={styles.dash}>—</Text>
              <TextInput
                value={r.end}
                onChangeText={(v) => setDraft(draft.map((x, j) => (j === i ? { ...x, end: v } : x)))}
                placeholder="17:00"
                keyboardType="numbers-and-punctuation"
                style={styles.timeInput}
              />
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setDraft(draft.filter((_, j) => j !== i))}
                style={styles.removeBtn}
              >
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setDraft([...draft, { start: '09:00', end: '17:00' }])}
            style={styles.addBtn}
          >
            <Text style={styles.addText}>+ Add hours</Text>
          </TouchableOpacity>

          <View style={styles.actions}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => save(null)}
              disabled={saving}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryText}>Use usual hours</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => save(draft)}
              disabled={saving}
              style={styles.saveBtn}
            >
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save this date'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity activeOpacity={0.7} onPress={() => setSelected(null)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Close</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper, padding: 16 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper, padding: 24 },
  heading: { fontSize: 24, fontWeight: '600', color: colors.forestDark, marginBottom: 6 },
  intro: { fontSize: 13, color: colors.inkSoft, lineHeight: 20, marginBottom: 16 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  navBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8 },
  navText: { fontSize: 20, color: colors.ink },
  monthLabel: { fontSize: 17, fontWeight: '600', color: colors.ink },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekLabel: { flex: 1, textAlign: 'center', fontSize: 11, color: colors.inkSoft },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // ~14% each so seven fit a row, and 44 tall for the HIG minimum.
  cell: { width: '14.28%', height: 44, alignItems: 'center', justifyContent: 'center' },
  day: { borderRadius: 8 },
  dayOn: { backgroundColor: '#E3E9E1' },
  dayOff: { backgroundColor: 'transparent' },
  daySelected: { borderWidth: 2, borderColor: colors.forest },
  dayPast: { opacity: 0.3 },
  dayNum: { fontSize: 14, color: colors.inkSoft },
  dayNumOn: { fontSize: 14, color: colors.forestDark, fontWeight: '600' },
  dot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: '#7A5A22' },
  legend: { fontSize: 11, color: colors.inkSoft, lineHeight: 17, marginTop: 10 },
  editor: { marginTop: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 16 },
  editorTitle: { fontSize: 16, fontWeight: '600', color: colors.ink, marginBottom: 12 },
  hint: { fontSize: 13, color: colors.inkSoft, marginBottom: 10 },
  error: { fontSize: 13, color: colors.brick, marginBottom: 10 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  timeInput: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, fontSize: 16, color: colors.ink },
  dash: { color: colors.inkSoft },
  removeBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  removeText: { fontSize: 12, color: colors.brick, textDecorationLine: 'underline' },
  addBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.forest, borderRadius: 8, marginBottom: 12 },
  addText: { fontSize: 14, color: colors.forest, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 8 },
  secondaryBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8 },
  secondaryText: { fontSize: 13, color: colors.ink },
  saveBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forest, borderRadius: 8 },
  saveText: { fontSize: 14, color: '#fff', fontWeight: '500' },
  cancelBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  cancelText: { fontSize: 13, color: colors.inkSoft },
});
