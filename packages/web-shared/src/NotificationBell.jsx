import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { timeAgo } from './format.js';

const SOUND_PREF_KEY = 'gm_notification_sound';

/**
 * Play a short two-tone chime using the Web Audio API.
 *
 * Synthesised rather than shipping an audio file: it's a few hundred
 * bytes of code instead of a binary asset, needs no loading, and can't
 * 404. Deliberately quiet and short — this fires while someone may be
 * with a grieving client, so it must never be startling.
 *
 * Browsers block audio until the user has interacted with the page, so
 * this can throw on the very first notification. That's caught and
 * ignored: a silent notification is fine, a crash is not.
 */
function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();

    const play = (freq, startAt, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Short fade in/out — a raw square start produces an audible click.
      gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
      gain.gain.linearRampToValueAtTime(0.09, ctx.currentTime + startAt + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + duration);
    };

    play(880, 0, 0.16);
    play(1174, 0.12, 0.2);

    // Release the audio context once the sound has finished, rather than
    // leaking one per notification.
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {
    /* audio unavailable or blocked — silence is an acceptable outcome */
  }
}


/**
 * Notification bell with a dropdown of recent notifications.
 *
 * @param {object} props
 * @param {Function} props.apiFetch the app's authenticated fetch
 */
export default function NotificationBell({ apiFetch }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [soundOn, setSoundOn] = useState(() => {
    try {
      // Default ON: a notification nobody notices is close to useless.
      return localStorage.getItem(SOUND_PREF_KEY) !== 'off';
    } catch {
      return true;
    }
  });

  // Tracks the previous unread count so we can chime on an INCREASE
  // only. Without this, every poll with a non-zero count would sound.
  const prevUnread = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications);
      setUnread(data.unread);

      // Skip the very first load: arriving at a page with 5 unread from
      // yesterday shouldn't play a sound.
      if (prevUnread.current !== null && data.unread > prevUnread.current && soundOn) {
        playChime();
      }
      prevUnread.current = data.unread;
    } catch {
      /* transient network failure — the next poll will catch up */
    }
  }, [apiFetch, soundOn]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  // Close on outside click, so the dropdown doesn't linger over content.
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    try {
      localStorage.setItem(SOUND_PREF_KEY, next ? 'on' : 'off');
    } catch { /* storage unavailable */ }
    // Play a sample when switching ON, so it's clear what was enabled
    // (and it doubles as the user gesture browsers require).
    if (next) playChime();
  };

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read_at) {
      apiFetch(`/notifications/${n.id}/read`, { method: 'POST' })
        .then(load)
        .catch(() => {});
    }
    // Client-side navigation rather than window.location, so the SPA
    // doesn't do a full reload and lose in-memory auth state.
    if (n.url) navigate(n.url);
  };

  const markAllRead = async () => {
    await apiFetch('/notifications/read-all', { method: 'POST' }).catch(() => {});
    load();
  };

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <button onClick={() => setOpen((v) => !v)} style={styles.bellBtn} aria-label="Notifications">
        <span style={styles.bellIcon}>🔔</span>
        {unread > 0 && <span style={styles.badge}>{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div style={styles.panel}>
          <div style={styles.panelHead}>
            <span style={styles.panelTitle}>Notifications</span>
            <div style={styles.headActions}>
              <button
                onClick={toggleSound}
                style={styles.iconBtn}
                title={soundOn ? 'Sound on — tap to mute' : 'Sound off — tap to unmute'}
              >
                {soundOn ? '🔊' : '🔇'}
              </button>
              {unread > 0 && (
                <button onClick={markAllRead} style={styles.markAll}>Mark all read</button>
              )}
            </div>
          </div>

          <div style={styles.list}>
            {items.length === 0 ? (
              <p style={styles.empty}>Nothing yet.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  style={{ ...styles.item, ...(n.read_at ? {} : styles.itemUnread) }}
                >
                  <div style={styles.itemTitle}>{n.title}</div>
                  {n.body && <div style={styles.itemBody}>{n.body}</div>}
                  <div style={styles.itemTime}>{timeAgo(n.created_at)}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { position: 'relative', flexShrink: 0 },
  bellBtn: { position: 'relative', background: 'none', border: 'none', padding: 4, cursor: 'pointer', lineHeight: 1 },
  bellIcon: { fontSize: 20 },
  badge: {
    position: 'absolute', top: -2, right: -4,
    background: 'var(--gm-brick)', color: '#fff',
    borderRadius: 999, fontSize: 10, fontWeight: 700,
    padding: '1px 5px', minWidth: 16, textAlign: 'center',
  },
  panel: {
    position: 'absolute', top: 34, right: 0, zIndex: 50,
    width: 300, maxWidth: '90vw',
    background: '#fff', border: '1px solid var(--gm-line)',
    borderRadius: 'var(--gm-radius)', boxShadow: '0 6px 24px rgba(0,0,0,0.14)',
    overflow: 'hidden',
  },
  panelHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 12px', borderBottom: '1px solid var(--gm-line-soft)',
  },
  panelTitle: { fontSize: 13, fontWeight: 600, color: 'var(--gm-ink)' },
  headActions: { display: 'flex', alignItems: 'center', gap: 8 },
  iconBtn: { background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', padding: 0, lineHeight: 1 },
  markAll: { background: 'none', border: 'none', color: 'var(--gm-forest)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline', padding: 0 },
  list: { maxHeight: 360, overflowY: 'auto' },
  empty: { fontSize: 13, color: 'var(--gm-ink-soft)', padding: 16, margin: 0, textAlign: 'center' },
  item: {
    display: 'block', width: '100%', textAlign: 'left',
    background: 'none', border: 'none',
    borderBottom: '1px solid var(--gm-line-soft)',
    padding: '10px 12px', cursor: 'pointer',
  },
  itemUnread: { background: 'var(--gm-honey-soft)' },
  itemTitle: { fontSize: 13, fontWeight: 600, color: 'var(--gm-ink)' },
  itemBody: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2, lineHeight: 1.4 },
  itemTime: { fontSize: 10, color: 'var(--gm-ink-soft)', marginTop: 4 },
};
