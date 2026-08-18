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
