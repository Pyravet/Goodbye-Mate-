import { useEffect, useState, useRef } from 'react';
import { fetchInternalMessages, sendInternalMessage } from './jobsApi.js';

// Polls rather than a websocket — the volume here is low (a handful of
// messages per job) and this keeps the stack simple. 8s feels responsive
// without hammering the server.
const POLL_MS = 8000;

export default function MessageThread({ jobId, currentUserId }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);

  const load = (scrollToBottom) => {
    fetchInternalMessages(jobId)
      .then((msgs) => {
        setMessages(msgs);
        if (scrollToBottom && listRef.current) {
          requestAnimationFrame(() => { listRef.current.scrollTop = listRef.current.scrollHeight; });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(true);
    const interval = setInterval(() => load(false), POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const onSend = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setError('');
    setSending(true);
    try {
      await sendInternalMessage(jobId, draft.trim());
      setDraft('');
      load(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div ref={listRef} style={styles.list}>
        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : messages.length === 0 ? (
          <p style={styles.empty}>No messages yet — anything the vet should know before the visit?</p>
        ) : (
          messages.map((m) => {
            const isMine = m.sender_user_id === currentUserId;
            return (
              <div key={m.id} style={{ ...styles.bubbleRow, justifyContent: isMine ? 'flex-end' : 'flex-start' }}>
                <div style={{ ...styles.bubble, ...(isMine ? styles.bubbleMine : styles.bubbleTheirs) }}>
                  {!isMine && <div style={styles.senderName}>{m.sender_name}</div>}
                  <div>{m.body}</div>
                  <div style={styles.timestamp}>{new Date(m.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}

      <form onSubmit={onSend} style={styles.form}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the vet…"
          style={styles.input}
        />
        <button type="submit" disabled={sending || !draft.trim()} style={styles.sendBtn}>Send</button>
      </form>
    </div>
  );
}

const styles = {
  list: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto', marginBottom: 10, paddingRight: 4 },
  empty: { fontSize: 13, color: 'var(--gm-ink-soft)' },
  bubbleRow: { display: 'flex' },
  bubble: { maxWidth: '80%', padding: '8px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.4 },
  bubbleMine: { background: 'var(--gm-forest)', color: '#fff', borderBottomRightRadius: 3 },
  bubbleTheirs: { background: 'var(--gm-line-soft)', color: 'var(--gm-ink)', borderBottomLeftRadius: 3 },
  senderName: { fontSize: 11, fontWeight: 600, marginBottom: 2, opacity: 0.75 },
  timestamp: { fontSize: 10, opacity: 0.6, marginTop: 4 },
  error: { fontSize: 12, color: 'var(--gm-brick)', marginBottom: 8 },
  form: { display: 'flex', gap: 8 },
  input: { flex: 1, padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 13 },
  sendBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '8px 16px', fontSize: 13, fontWeight: 500 },
};
