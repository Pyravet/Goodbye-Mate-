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
