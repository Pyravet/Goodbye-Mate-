/**
 * Should a push notification be delivered right now?
 *
 * Vets are on call at odd hours and a 3am alert about nothing is how an
 * app gets uninstalled. But the opposite failure is worse: a vet who
 * silently stops receiving offers loses work and has no idea why.
 *
 * So pausing is bounded (it expires by itself), quiet hours are a
 * nightly window rather than an off switch, and neither can suppress
 * something the vet has already committed to.
 */

const TZ = 'Australia/Melbourne';

/**
 * Categories that IGNORE both pause and quiet hours.
 *
 * A vet who has accepted a job has made a commitment, and an
 * appointment reminder for a visit they're about to miss is not
 * marketing — it's the one message that has to arrive. Same for a job
 * being cancelled out from under them: turning up to a cancelled
 * euthanasia is worse than being woken.
 *
 * Offers are NOT on this list. An offer is an invitation, and declining
 * by silence is a legitimate answer at 3am.
 */
const ALWAYS_DELIVER = new Set(['reminder', 'cancellation', 'reassignment']);

/** Hour of day in the business's timezone, 0–23. */
function hourIn(tz, now) {
  return Number(
    new Intl.DateTimeFormat('en-AU', { timeZone: tz, hour: 'numeric', hour12: false }).format(now)
  ) % 24;
}

/**
 * Is `now` inside the vet's quiet window?
 *
 * Handles windows that cross midnight (22 → 7), which is the normal
 * case — a window that only worked within one calendar day would be
 * useless for exactly the hours people want protected.
 */
export function inQuietHours(start, end, now = new Date()) {
  if (start == null || end == null) return false;
  if (start === end) return false; // a zero-length window means "off"
  const h = hourIn(TZ, now);
  return start < end ? (h >= start && h < end) : (h >= start || h < end);
}

/**
 * @param {object} user { notifications_paused_until, quiet_hours_start, quiet_hours_end }
 * @param {string} [category] the notification's category
 * @returns {{deliver: boolean, reason: string|null}}
 */
export function shouldDeliverPush(user, category, now = new Date()) {
  if (ALWAYS_DELIVER.has(category)) {
    return { deliver: true, reason: null };
  }

  const until = user?.notifications_paused_until
    ? new Date(user.notifications_paused_until)
    : null;
  // An expired pause is simply over — no cleanup needed, and no way for
  // a stale row to keep someone silenced indefinitely.
  if (until && until > now) {
    return { deliver: false, reason: 'paused' };
  }

  if (inQuietHours(user?.quiet_hours_start, user?.quiet_hours_end, now)) {
    return { deliver: false, reason: 'quiet-hours' };
  }

  return { deliver: true, reason: null };
}

/**
 * Rough driving time, in minutes, for the en-route ETA.
 *
 * Used when Google's Distance Matrix isn't available — which is the
 * current state, and was the whole reason "On my way" failed for every
 * vet for a while. A rough honest number beats no number: the client
 * mainly wants to know someone is coming and roughly when.
 *
 * Straight-line distance with a detour factor, because roads are not
 * straight. 1.3 is the usual figure for urban road networks.
 *
 * @returns {number|null} minutes, or null when coordinates are missing
 */
export function estimateEtaMinutes({ fromLat, fromLng, toLat, toLng, avgSpeedKmh = 45 }) {
  if ([fromLat, fromLng, toLat, toLng].some((v) => v == null || !Number.isFinite(Number(v)))) {
    return null;
  }
  const R = 6371; // km
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2;
  const straightKm = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));

  const roadKm = straightKm * 1.3;
  const minutes = (roadKm / (Number(avgSpeedKmh) || 45)) * 60;

  // Rounded to 5 minutes, because presenting "23 minutes" from a
  // straight-line estimate implies a precision it does not have. A
  // family watching the clock deserves an honest approximation, not a
  // confident-looking guess.
  const rounded = Math.max(5, Math.round(minutes / 5) * 5);
  // Above a couple of hours the estimate is meaningless — better to say
  // nothing than to promise something absurd.
  return rounded > 180 ? null : rounded;
}
