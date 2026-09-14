/**
 * Shared formatting for the native app.
 *
 * Both of these exist because the same two bugs kept recurring on the
 * web side and were then repeated here.
 */

/**
 * Every pet on a visit, not just the mirrored first one.
 *
 * jobs.pet_name mirrors the FIRST pet only, so a double euthanasia
 * displayed as one animal — the wrong work at a glance and the wrong
 * duration to plan around.
 */
export function petNames(job) {
  const raw = job?.pet_names || job?.pet_name || '';
  const list = String(raw).split(',').map((n) => n.trim()).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * A job's date, formatted safely.
 *
 * The API sends "2026-09-15T00:00:00.000Z" and `new Date(that)` parses
 * as UTC midnight — which renders as the PREVIOUS day anywhere west of
 * Greenwich. Pinning to local midnight removes the timezone from the
 * question. This exact trap has caused four separate bugs.
 */
export function formatJobDate(value, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  if (!value) return '';
  const iso = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-AU', opts);
}
