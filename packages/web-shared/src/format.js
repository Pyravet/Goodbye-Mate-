// Shared display formatters. These were previously copy-pasted across 7
// files in 3 apps, with three subtly different variants already drifting
// apart (only one had a null guard) — exactly the kind of duplication
// that turns into an inconsistency bug.

// "14:30" -> "2:30pm". Returns '' for missing input rather than throwing,
// which is what the client journey's copy did and the others didn't.
export function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${period}`;
}

// Compact variant used by the admin calendar: drops ":00" on the hour,
// so 14:00 -> "2pm" but 14:30 -> "2:30pm".
export function formatHourCompact(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${period}`;
}

export function formatMoney(n) {
  return `$${(n || 0).toFixed(2)}`;
}

/**
 * Format card expiry as MM/YY while the user types.
 *
 * Shared because both payment forms need identical behaviour and they'd
 * otherwise drift — the admin form had this and the client-facing one
 * didn't, so a client typing "1228" got no slash, the MM/YY split
 * failed, and they were told to "enter expiry as MM/YY" with no clue
 * what was actually wrong.
 *
 * Digits only, capped at four, slash inserted after the month.
 */
export function formatExpiry(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/**
 * Relative time for lists: "just now", "5m ago", "3h ago", "2d ago",
 * then an absolute date past a week.
 *
 * Shared because two copies had already drifted — one guarded against a
 * missing timestamp and the other would have thrown on it. That is the
 * same failure mode formatTime had before it was consolidated.
 */
export function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

/**
 * Local calendar date as 'YYYY-MM-DD'.
 *
 * Deliberately built from local date parts rather than toISOString(),
 * which converts to UTC first and returns the PREVIOUS day for anyone
 * in Australia for most of the evening — the exact bug that put jobs in
 * the wrong calendar cell.
 */
export function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
