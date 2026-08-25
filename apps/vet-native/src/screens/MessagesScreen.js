import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { colors } from '../theme.js';
import {
  listConversations, fetchConversation, listRecipients,
  startConversation, sendReply, deleteMessage,
} from '../api/messagesApi.js';
import { useAuth } from '../AuthContext.js';

function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function MessagesScreen() {
  const [view, setView] = useState('inbox'); // inbox | thread | compose
  const [openId, setOpenId] = useState(null);

  if (view === 'compose') {
    return <Compose onDone={() => setView('inbox')} onCancel={() => setView('inbox')} />;
  }
  if (view === 'thread' && openId) {
    return <Thread conversationId={openId} onBack={() => { setOpenId(null); setView('inbox'); }} />;
  }
  return (
    <Inbox
      onOpen={(id) => { setOpenId(id); setView('thread'); }}
      onCompose={() => setView('compose')}
    />
  );
}

function Inbox({ onOpen, onCompose }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    listConversations()
      .then(setItems)
      .catch((err) => { setError(err.message); setItems([]); });
  }, []);

  useEffect(() => {
    load();
    // Modest interval: these are operational messages, not live chat,
    // and tighter polling drains a phone battery in the field.
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <View style={styles.screen}>
      <TouchableOpacity activeOpacity={0.7} onPress={onCompose} style={styles.primaryBtn}>
        <Text style={styles.primaryBtnText}>+ New message</Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView>
        {items === null ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={colors.forest} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>No messages yet.</Text>
        ) : (
          items.map((c) => (
            <TouchableOpacity activeOpacity={0.7} key={c.id} onPress={() => onOpen(c.id)} style={styles.card}>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text style={[styles.cardTitle, c.unreadCount > 0 && styles.bold]} numberOfLines={1}>
                    {c.title}
                  </Text>
                  {c.unreadCount > 0 && (
                    <View style={styles.badge}><Text style={styles.badgeText}>{c.unreadCount}</Text></View>
                  )}
                </View>
                <Text style={styles.preview} numberOfLines={1}>
                  {c.lastSenderName ? `${c.lastSenderName}: ` : ''}{c.lastMessage}
                </Text>
              </View>
              <Text style={styles.time}>{timeAgo(c.lastMessageAt)}</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function Thread({ conversationId, onBack }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  const load = useCallback((scroll) => {
    fetchConversation(conversationId)
      .then((d) => {
        setData(d);
        if (scroll) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 60);
      })
      .catch((err) => setError(err.message));
  }, [conversationId]);

  useEffect(() => {
    load(true);
    const t = setInterval(() => load(false), 20000);
    return () => clearInterval(t);
  }, [load]);

  const send = async () => {
    if (!draft.trim()) return;
    setSending(true);
    setError('');
    try {
      await sendReply(conversationId, draft.trim());
      setDraft('');
      load(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const remove = (messageId) => {
    Alert.alert(
      'Delete message?',
      'The other person will see that a message was removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMessage(conversationId, messageId);
              load(false);
            } catch (err) {
              setError(err.message);
            }
          },
        },
      ]
    );
  };

  const isBroadcast = data?.conversation?.kind === 'broadcast_child';

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <TouchableOpacity activeOpacity={0.7} onPress={onBack}>
        <Text style={styles.back}>← All messages</Text>
      </TouchableOpacity>

      {isBroadcast && (
        <Text style={styles.privateNote}>
          Private thread — other recipients of this message can't see it.
        </Text>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView ref={scrollRef} style={{ flex: 1 }}>
        {!data ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={colors.forest} />
        ) : (
          data.messages.map((m) => {
            const mine = m.sender_user_id === user?.id;
            return (
              <TouchableOpacity
                key={m.id}
                activeOpacity={mine && !m.deleted_at ? 0.7 : 1}
                onLongPress={mine && !m.deleted_at ? () => remove(m.id) : undefined}
                style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}
              >
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  {!mine && <Text style={styles.sender}>{m.sender_name}</Text>}
                  <Text style={[
                    mine ? styles.bodyMine : styles.bodyTheirs,
                    m.deleted_at && styles.deleted,
                  ]}>
                    {m.deleted_at ? 'Message deleted' : m.body}
                  </Text>
                  <Text style={mine ? styles.timeMine : styles.timeTheirs}>
                    {new Date(m.created_at).toLocaleString('en-AU', {
                      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                    })}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
        {/* Long-press is not discoverable on its own, so say so once. */}
        {data?.messages?.length > 0 && (
          <Text style={styles.hint}>Long-press your own message to delete it.</Text>
        )}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Write a reply…"
          style={styles.input}
          multiline
        />
        <TouchableOpacity activeOpacity={0.7} onPress={send} disabled={sending || !draft.trim()} style={styles.sendBtn}>
          <Text style={styles.sendBtnText}>{sending ? '…' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function Compose({ onDone, onCancel }) {
  const [recipients, setRecipients] = useState(null);
  const [selected, setSelected] = useState([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    listRecipients().then(setRecipients).catch((err) => { setError(err.message); setRecipients([]); });
  }, []);

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const send = async () => {
    if (selected.length === 0 || !body.trim()) return;
    setSending(true);
    setError('');
    try {
      // Vets only ever message admin, so no broadcast option here —
      // the server enforces this regardless of what the UI offers.
      await startConversation({
        recipientIds: selected,
        body: body.trim(),
        subject: subject.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  };

  return (
    <ScrollView style={styles.screen}>
      <TouchableOpacity activeOpacity={0.7} onPress={onCancel}>
        <Text style={styles.back}>← Cancel</Text>
      </TouchableOpacity>
      <Text style={styles.heading}>New message</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.label}>To</Text>
      {recipients === null ? (
        <ActivityIndicator color={colors.forest} />
      ) : recipients.length === 0 ? (
        <Text style={styles.empty}>No one available to message.</Text>
      ) : (
        <View style={styles.chipRow}>
          {recipients.map((r) => (
            <TouchableOpacity activeOpacity={0.7}
              key={r.id}
              onPress={() => toggle(r.id)}
              style={[styles.chip, selected.includes(r.id) && styles.chipOn]}
            >
              <Text style={selected.includes(r.id) ? styles.chipTextOn : styles.chipText}>
                {r.full_name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={styles.label}>Subject (optional)</Text>
      <TextInput value={subject} onChangeText={setSubject} style={styles.input} />

      <Text style={styles.label}>Message</Text>
      <TextInput value={body} onChangeText={setBody} style={[styles.input, { height: 120 }]} multiline />

      <TouchableOpacity activeOpacity={0.7}
        onPress={send}
        disabled={sending || selected.length === 0 || !body.trim()}
        style={[styles.primaryBtn, (selected.length === 0 || !body.trim()) && styles.disabled]}
      >
        <Text style={styles.primaryBtnText}>{sending ? 'Sending…' : 'Send'}</Text>
      </TouchableOpacity>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper, padding: 16 },
  heading: { fontSize: 20, fontWeight: '600', color: colors.forestDark, marginBottom: 12 },
  back: { color: colors.inkSoft, fontSize: 14, marginBottom: 10 },
  primaryBtn: { backgroundColor: colors.forest, borderRadius: 8, paddingVertical: 13, alignItems: 'center', marginBottom: 14 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  disabled: { opacity: 0.5 },
  empty: { color: colors.inkSoft, fontSize: 13, marginTop: 12 },
  error: { color: colors.brick, fontSize: 13, marginBottom: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, marginBottom: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  bold: { fontWeight: '700' },
  badge: { backgroundColor: colors.brick, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  preview: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  time: { fontSize: 11, color: colors.inkSoft },
  privateNote: { fontSize: 11, color: '#7A5A22', backgroundColor: '#F3E6CB', padding: 8, borderRadius: 6, marginBottom: 10 },
  bubbleRow: { flexDirection: 'row', marginBottom: 8 },
  bubble: { maxWidth: '85%', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14 },
  bubbleMine: { backgroundColor: colors.forest, borderBottomRightRadius: 3 },
  bubbleTheirs: { backgroundColor: '#F0EBE0', borderBottomLeftRadius: 3 },
  sender: { fontSize: 11, fontWeight: '600', color: colors.inkSoft, marginBottom: 2 },
  bodyMine: { color: '#fff', fontSize: 14, lineHeight: 20 },
  bodyTheirs: { color: colors.ink, fontSize: 14, lineHeight: 20 },
  deleted: { fontStyle: 'italic', opacity: 0.7 },
  timeMine: { color: 'rgba(255,255,255,0.7)', fontSize: 10, marginTop: 4 },
  timeTheirs: { color: colors.inkSoft, fontSize: 10, marginTop: 4 },
  hint: { fontSize: 11, color: colors.inkSoft, fontStyle: 'italic', textAlign: 'center', marginVertical: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 8 },
  input: { minHeight: 44, flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 10 },
  sendBtn: { backgroundColor: colors.forest, borderRadius: 8, paddingHorizontal: 18, paddingVertical: 12, marginBottom: 10 },
  sendBtnText: { color: '#fff', fontWeight: '500' },
  label: { fontSize: 12, color: colors.inkSoft, marginBottom: 4, marginTop: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.forest, borderColor: colors.forest },
  chipText: { color: colors.ink, fontSize: 13 },
  chipTextOn: { color: '#fff', fontSize: 13 },
});
