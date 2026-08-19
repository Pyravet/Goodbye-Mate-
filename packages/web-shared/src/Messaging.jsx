import { useEffect, useState, useCallback, useRef } from 'react';

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

/**
 * Full messaging surface: inbox, thread view, and compose.
 *
 * One component used by both admin and vet. The only difference between
 * them is who they can message and whether broadcast is offered, both
 * passed in — the server enforces the real rules regardless.
 *
 * @param {object} props
 * @param {object} props.api        from makeConversationsApi(apiFetch)
 * @param {string} props.currentUserId  to align own messages right
 * @param {boolean} [props.canBroadcast] admin only
 */
export default function Messaging({ api, currentUserId, canBroadcast = false }) {
  const [conversations, setConversations] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [openBroadcast, setOpenBroadcast] = useState(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState('');

  const loadInbox = useCallback(() => {
    api.listConversations()
      .then(setConversations)
      .catch((err) => { setError(err.message); setConversations([]); });
  }, [api]);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  // Poll while the inbox is open. Deliberately modest (15s): messages
  // here are operational, not a live chat, and a tighter interval would
  // burn mobile battery and API quota for no real benefit.
  useEffect(() => {
    if (openId || composing) return undefined;
    const t = setInterval(loadInbox, 15000);
    return () => clearInterval(t);
  }, [openId, composing, loadInbox]);

  if (composing) {
    return (
      <Compose
        api={api}
        canBroadcast={canBroadcast}
        onCancel={() => setComposing(false)}
        onSent={() => { setComposing(false); loadInbox(); }}
      />
    );
  }

  if (openBroadcast) {
    return (
      <BroadcastView
        api={api}
        broadcastId={openBroadcast}
        onOpenThread={(id) => { setOpenBroadcast(null); setOpenId(id); }}
        onBack={() => { setOpenBroadcast(null); loadInbox(); }}
      />
    );
  }

  if (openId) {
    return (
      <Thread
        api={api}
        conversationId={openId}
        currentUserId={currentUserId}
        canAddPeople={canBroadcast}
        onBack={() => { setOpenId(null); loadInbox(); }}
      />
    );
  }

  return (
    <div>
      <button onClick={() => setComposing(true)} style={styles.newBtn}>+ New message</button>
      {error && <p style={styles.error}>{error}</p>}

      {conversations === null ? (
        <p style={styles.empty}>Loading…</p>
      ) : conversations.length === 0 ? (
        <p style={styles.empty}>No messages yet.</p>
      ) : (
        collapseBroadcasts(conversations, canBroadcast).map((c) => (
          c.isBroadcastGroup ? (
            <BroadcastRow key={c.broadcastId} group={c} onOpen={() => setOpenBroadcast(c.broadcastId)} />
          ) : (
          <button key={c.id} onClick={() => setOpenId(c.id)} style={styles.row} className="gm-card">
            <div style={styles.rowMain}>
              <div style={styles.rowTop}>
                <span style={{ ...styles.rowTitle, fontWeight: c.unreadCount > 0 ? 700 : 600 }}>
                  {c.title}
                </span>
                {c.unreadCount > 0 && <span style={styles.badge}>{c.unreadCount}</span>}
              </div>
              {c.subject && c.kind !== 'direct' && <div style={styles.rowSubject}>{c.subject}</div>}
              <div style={styles.rowPreview}>
                {c.lastSenderName ? `${c.lastSenderName}: ` : ''}{c.lastMessage}
              </div>
            </div>
            <span style={styles.rowTime}>{timeAgo(c.lastMessageAt)}</span>
          </button>
          )
        ))
      )}
    </div>
  );
}

function Thread({ api, conversationId, currentUserId, canAddPeople, onBack }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [recipients, setRecipients] = useState([]);
  const listRef = useRef(null);

  const load = useCallback((scroll) => {
    api.fetchConversation(conversationId)
      .then((d) => {
        setData(d);
        if (scroll && listRef.current) {
          requestAnimationFrame(() => {
            listRef.current.scrollTop = listRef.current.scrollHeight;
          });
        }
      })
      .catch((err) => setError(err.message));
  }, [api, conversationId]);

  useEffect(() => { load(true); }, [load]);

  useEffect(() => {
    const t = setInterval(() => load(false), 15000);
    return () => clearInterval(t);
  }, [load]);

  const send = async () => {
    if (!draft.trim()) return;
    setSending(true);
    setError('');
    try {
      await api.sendReply(conversationId, draft.trim());
      setDraft('');
      load(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const removeMessage = async (messageId) => {
    if (!window.confirm('Delete this message? The other person will see that a message was removed.')) return;
    setError('');
    try {
      await api.deleteMessage(conversationId, messageId);
      load(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const openAdd = async () => {
    setAdding(true);
    setError('');
    try {
      setRecipients(await api.listRecipients());
    } catch (err) {
      setError(err.message);
    }
  };

  const add = async (userId) => {
    setError('');
    try {
      await api.addParticipant(conversationId, userId);
      setAdding(false);
      load(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const isBroadcastChild = data?.conversation?.kind === 'broadcast_child';
  const participantNames = (data?.participants || [])
    .filter((p) => p.id !== currentUserId)
    .map((p) => p.full_name)
    .join(', ');

  return (
    <div>
      <button onClick={onBack} style={styles.back}>← All messages</button>

      <div style={styles.threadHeader}>
        <div style={styles.threadTitle}>{data?.conversation?.subject || participantNames || 'Conversation'}</div>
        {participantNames && data?.conversation?.subject && (
          <div style={styles.threadWith}>with {participantNames}</div>
        )}
        {isBroadcastChild && (
          <div style={styles.privateNote}>
            Private thread — the other recipients of this message can't see it.
          </div>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}

      {canAddPeople && !isBroadcastChild && (
        adding ? (
          <div style={styles.addBox}>
            <div style={styles.addTitle}>Add someone to this conversation</div>
            {recipients.length === 0 ? (
              <p style={styles.empty}>No one available to add.</p>
            ) : (
              recipients.map((r) => (
                <button key={r.id} onClick={() => add(r.id)} style={styles.addRow}>{r.full_name}</button>
              ))
            )}
            <button onClick={() => setAdding(false)} style={styles.cancelLink}>Cancel</button>
          </div>
        ) : (
          <button onClick={openAdd} style={styles.addPeopleBtn}>+ Add someone</button>
        )
      )}

      <div ref={listRef} style={styles.messages}>
        {!data ? (
          <p style={styles.empty}>Loading…</p>
        ) : (
          data.messages.map((m) => {
            const mine = m.sender_user_id === currentUserId;
            return (
              <div key={m.id} style={{ ...styles.bubbleRow, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                <div style={{ ...styles.bubble, ...(mine ? styles.bubbleMine : styles.bubbleTheirs) }}>
                  {!mine && <div style={styles.sender}>{m.sender_name}</div>}
                  {m.deleted_at ? (
                    <div style={styles.deletedBody}>Message deleted</div>
                  ) : (
                    <div style={styles.body}>{m.body}</div>
                  )}
                  <div style={styles.time}>
                    {new Date(m.created_at).toLocaleString('en-AU', {
                      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                    })}
                    {/* Only your own, still-present messages can be
                        deleted — the server enforces this too. */}
                    {mine && !m.deleted_at && (
                      <button onClick={() => removeMessage(m.id)} style={styles.deleteBtn} title="Delete message">
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={styles.composer}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Write a reply…"
          style={styles.input}
        />
        <button onClick={send} disabled={sending || !draft.trim()} style={styles.sendBtn}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function Compose({ api, canBroadcast, onCancel, onSent }) {
  const [recipients, setRecipients] = useState(null);
  const [selected, setSelected] = useState([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [separate, setSeparate] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listRecipients().then(setRecipients).catch((err) => { setError(err.message); setRecipients([]); });
  }, [api]);

  const toggle = (id) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const send = async () => {
    if (selected.length === 0 || !body.trim()) return;
    setSending(true);
    setError('');
    try {
      await api.startConversation({
        recipientIds: selected,
        body: body.trim(),
        subject: subject.trim() || null,
        // Only meaningful with more than one recipient.
        separateThreads: canBroadcast && selected.length > 1 ? separate : false,
      });
      onSent();
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  };

  const multi = selected.length > 1;

  return (
    <div>
      <button onClick={onCancel} style={styles.back}>← Cancel</button>
      <div style={styles.threadTitle}>New message</div>

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.label}>To</div>
      {recipients === null ? (
        <p style={styles.empty}>Loading…</p>
      ) : recipients.length === 0 ? (
        <p style={styles.empty}>No one available to message.</p>
      ) : (
        <div style={styles.recipientList}>
          {recipients.map((r) => (
            <button
              key={r.id}
              onClick={() => toggle(r.id)}
              style={{
                ...styles.recipientChip,
                ...(selected.includes(r.id) ? styles.recipientChipOn : {}),
              }}
            >
              {r.full_name}
            </button>
          ))}
        </div>
      )}

      {canBroadcast && multi && (
        <div style={styles.modeBox}>
          <label style={styles.modeOption}>
            <input type="radio" checked={separate} onChange={() => setSeparate(true)} />
            <span>
              <strong>Separate replies</strong>
              <br />
              <span style={styles.modeHint}>
                Each person gets their own private thread and can't see the others. Best for
                "can anyone cover Thursday?".
              </span>
            </span>
          </label>
          <label style={styles.modeOption}>
            <input type="radio" checked={!separate} onChange={() => setSeparate(false)} />
            <span>
              <strong>Group conversation</strong>
              <br />
              <span style={styles.modeHint}>Everyone sees each other's replies.</span>
            </span>
          </label>
        </div>
      )}

      <div style={styles.label}>Subject (optional)</div>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="e.g. Thursday cover"
        style={styles.input}
      />

      <div style={styles.label}>Message</div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder="Write your message…"
        style={styles.input}
      />

      <button
        onClick={send}
        disabled={sending || selected.length === 0 || !body.trim()}
        style={styles.sendWideBtn}
      >
        {sending
          ? 'Sending…'
          : selected.length > 1
            ? `Send to ${selected.length} people`
            : 'Send'}
      </button>
    </div>
  );
}


/**
 * Collapse a broadcast's per-recipient threads into ONE inbox row.
 *
 * A broadcast to eight vets creates eight conversations. Listing all of
 * them would bury every other message under near-identical rows. Admin
 * sees a single row ("Sent to 8 vets · 3 replied") that opens a summary.
 * Vets are unaffected — each only ever has their own thread.
 */
function collapseBroadcasts(conversations, isAdmin) {
  if (!isAdmin) return conversations;

  const groups = new Map();
  const out = [];

  for (const c of conversations) {
    if (!c.broadcastId) { out.push(c); continue; }

    if (!groups.has(c.broadcastId)) {
      const group = {
        isBroadcastGroup: true,
        broadcastId: c.broadcastId,
        subject: c.subject || c.title,
        threadCount: 0,
        repliedCount: 0,
        unreadCount: 0,
        lastMessageAt: c.lastMessageAt,
        namesList: [],
      };
      groups.set(c.broadcastId, group);
      out.push(group);
    }

    const g = groups.get(c.broadcastId);
    g.threadCount += 1;
    g.unreadCount += c.unreadCount;
    if (c.otherNames) g.namesList.push(c.otherNames);
    // Counts as replied when the newest message came from the recipient
    // rather than from us.
    if (c.lastSenderName && c.otherNames && c.lastSenderName === c.otherNames) {
      g.repliedCount += 1;
    }
    if (new Date(c.lastMessageAt) > new Date(g.lastMessageAt)) {
      g.lastMessageAt = c.lastMessageAt;
    }
  }

  for (const g of groups.values()) g.names = g.namesList.join(', ');
  return out;
}

function BroadcastRow({ group, onOpen }) {
  return (
    <button onClick={onOpen} style={styles.row} className="gm-card">
      <div style={styles.rowMain}>
        <div style={styles.rowTop}>
          <span style={{ ...styles.rowTitle, fontWeight: group.unreadCount > 0 ? 700 : 600 }}>
            {group.subject || 'Message to several vets'}
          </span>
          {group.unreadCount > 0 && <span style={styles.badge}>{group.unreadCount}</span>}
        </div>
        <div style={styles.rowSubject}>
          Sent to {group.threadCount} vets · {group.repliedCount} replied
        </div>
        <div style={styles.rowPreview}>{group.names}</div>
      </div>
      <span style={styles.rowTime}>{timeAgo(group.lastMessageAt)}</span>
    </button>
  );
}

/** All reply threads from one broadcast, side by side. */
function BroadcastView({ api, broadcastId, onOpenThread, onBack }) {
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.broadcastThreads(broadcastId)
      .then(setThreads)
      .catch((err) => { setError(err.message); setThreads([]); });
  }, [api, broadcastId]);

  return (
    <div>
      <button onClick={onBack} style={styles.back}>← All messages</button>
      <div style={styles.threadTitle}>{threads?.[0]?.subject || 'Message to several vets'}</div>
      <div style={styles.threadWith}>Each vet replied privately — they can't see one another.</div>

      {error && <p style={styles.error}>{error}</p>}

      <div style={{ marginTop: 12 }}>
        {threads === null ? (
          <p style={styles.empty}>Loading…</p>
        ) : threads.length === 0 ? (
          <p style={styles.empty}>No threads found.</p>
        ) : (
          threads.map((t) => (
            <button key={t.id} onClick={() => onOpenThread(t.id)} style={styles.row} className="gm-card">
              <div style={styles.rowMain}>
                <div style={styles.rowTop}>
                  <span style={styles.rowTitle}>{t.recipient_name}</span>
                  {t.has_replied
                    ? <span className="gm-badge gm-badge--forest">replied</span>
                    : <span className="gm-badge gm-badge--brick">no reply yet</span>}
                </div>
                <div style={styles.rowPreview}>
                  {t.last_sender_name ? t.last_sender_name + ': ' : ''}{t.last_body}
                </div>
              </div>
              <span style={styles.rowTime}>{timeAgo(t.last_message_at)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

const styles = {
  newBtn: { width: '100%', background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '11px 0', fontSize: 14, fontWeight: 500, marginBottom: 14 },
  empty: { color: 'var(--gm-ink-soft)', fontSize: 13 },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 10 },
  row: { width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', marginBottom: 8, textAlign: 'left', border: '1px solid var(--gm-line)', background: '#fff' },
  rowMain: { flex: 1, minWidth: 0 },
  rowTop: { display: 'flex', alignItems: 'center', gap: 8 },
  rowTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 15 },
  badge: { background: 'var(--gm-brick)', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 600, padding: '1px 7px' },
  rowSubject: { fontSize: 12, color: 'var(--gm-ink)', marginTop: 2 },
  rowPreview: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowTime: { fontSize: 11, color: 'var(--gm-ink-soft)', flexShrink: 0 },
  back: { background: 'none', border: 'none', color: 'var(--gm-ink-soft)', fontSize: 13, padding: '0 0 10px', cursor: 'pointer' },
  threadHeader: { marginBottom: 12 },
  threadTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 18, fontWeight: 600 },
  threadWith: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  privateNote: { fontSize: 11, color: '#7A5A22', background: 'var(--gm-honey-soft)', padding: '6px 9px', borderRadius: 'var(--gm-radius-sm)', marginTop: 8 },
  addPeopleBtn: { background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '6px 12px', fontSize: 12, marginBottom: 12 },
  addBox: { border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: 12, marginBottom: 12, background: '#fff' },
  addTitle: { fontSize: 12, fontWeight: 600, marginBottom: 8 },
  addRow: { display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--gm-line-soft)', padding: '8px 0', fontSize: 13 },
  cancelLink: { background: 'none', border: 'none', color: 'var(--gm-ink-soft)', fontSize: 12, textDecoration: 'underline', marginTop: 8, padding: 0 },
  messages: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '50vh', overflowY: 'auto', marginBottom: 12, paddingRight: 2 },
  bubbleRow: { display: 'flex' },
  bubble: { maxWidth: '85%', padding: '9px 13px', borderRadius: 14, fontSize: 14, lineHeight: 1.4 },
  bubbleMine: { background: 'var(--gm-forest)', color: '#fff', borderBottomRightRadius: 3 },
  bubbleTheirs: { background: 'var(--gm-line-soft)', color: 'var(--gm-ink)', borderBottomLeftRadius: 3 },
  sender: { fontSize: 11, fontWeight: 600, marginBottom: 2, opacity: 0.75 },
  body: { whiteSpace: 'pre-wrap' },
  time: { fontSize: 10, opacity: 0.6, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 },
  deleteBtn: { background: 'none', border: 'none', color: 'inherit', fontSize: 10, textDecoration: 'underline', cursor: 'pointer', padding: 0, opacity: 0.9 },
  deletedBody: { fontStyle: 'italic', opacity: 0.65 },
  composer: { display: 'flex', gap: 8, alignItems: 'flex-end' },
  input: { width: '100%', padding: '10px 12px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', background: '#fff', marginBottom: 10 },
  sendBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '10px 18px', fontSize: 14, fontWeight: 500, marginBottom: 10, flexShrink: 0 },
  sendWideBtn: { width: '100%', background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '12px 0', fontSize: 14, fontWeight: 500 },
  label: { fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 6, marginTop: 4 },
  recipientList: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  recipientChip: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 999, padding: '6px 12px', fontSize: 13 },
  recipientChipOn: { background: 'var(--gm-forest)', color: '#fff', borderColor: 'var(--gm-forest)' },
  modeBox: { border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: 12, marginBottom: 12, background: '#fff' },
  modeOption: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginBottom: 10 },
  modeHint: { fontSize: 11, color: 'var(--gm-ink-soft)', lineHeight: 1.4 },
};
