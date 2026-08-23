/**
 * Duplicate booking detection.
 *
 * A duplicate here is not a tidiness problem: it means two vets
 * dispatched to one grieving family, two charges, and two sets of
 * paperwork for one pet. It happens easily — a distressed person rings
 * and also submits the web form, or a family member books without
 * knowing someone else already has.
 *
 * Pure and DB-free so the matching rules are testable directly.
 */

/**
 * Reduce a phone number to comparable digits.
 *
 * Australian numbers get entered every way imaginable: "0400 111 222",
 * "+61 400 111 222", "0400-111-222". Without normalising, the same
 * person books twice and nothing matches, which is precisely when the
 * check is most needed.
 *
 * @param {string} phone
 * @returns {string} last 9 digits, or '' if unusable
 */
export function normalisePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 8) return '';
  // Compare the last 9 digits: that's the mobile number without the
  // leading 0 or the +61 country code, so all three forms collapse to
  // the same value.
  return digits.slice(-9);
}

/** Case- and whitespace-insensitive name comparison. */
function normaliseName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Score how likely an existing job is a duplicate of a proposed one.
 *
 * Returns a confidence rather than a boolean because the right response
 * differs: an exact phone + pet match on the same day should stop
 * someone in their tracks, whereas the same phone a fortnight later is
 * probably a second pet and should merely be mentioned.
 *
 * @param {object} candidate the booking being created
 * @param {object} existing a job already in the system
 * @returns {{level: 'high'|'medium'|'low'|null, reasons: string[], daysApart: number|null}}
 */
export function duplicateScore(candidate, existing) {
  const reasons = [];

  const samePhone = !!normalisePhone(candidate.clientPhone)
    && normalisePhone(candidate.clientPhone) === normalisePhone(existing.client_phone);
  const samePet = !!normaliseName(candidate.petName)
    && normaliseName(candidate.petName) === normaliseName(existing.pet_name);
  const sameClient = !!normaliseName(candidate.clientName)
    && normaliseName(candidate.clientName) === normaliseName(existing.client_name);
  const sameEmail = !!candidate.clientEmail
    && String(candidate.clientEmail).trim().toLowerCase() === String(existing.client_email || '').trim().toLowerCase();

  // Nothing links them at all.
  if (!samePhone && !sameEmail && !(sameClient && samePet)) {
    return { level: null, reasons: [], daysApart: null };
  }

  if (samePhone) reasons.push('same phone number');
  if (sameEmail) reasons.push('same email');
  if (sameClient) reasons.push('same client name');
  if (samePet) reasons.push(`same pet name (${existing.pet_name})`);

  const daysApart = daysBetween(candidate.date, existing.job_date);

  // Same pet, same contact, within a few days — this is almost certainly
  // the same booking made twice.
  if (samePet && (samePhone || sameEmail) && daysApart !== null && Math.abs(daysApart) <= 3) {
    return { level: 'high', reasons, daysApart };
  }
  // Same pet and contact, but further apart. Could be a rebooking after
  // a cancellation, so worth flagging rather than blocking.
  if (samePet && (samePhone || sameEmail)) {
    return { level: 'medium', reasons, daysApart };
  }
  // Same contact, different pet — most likely a second animal, which is
  // a real and sad thing that happens. Mention it, no more.
  return { level: 'low', reasons, daysApart };
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const d1 = new Date(`${String(a).slice(0, 10)}T00:00:00Z`);
  const d2 = new Date(`${String(b).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  return Math.round((d1 - d2) / 86400000);
}

/**
 * Rank matches so the most likely duplicate is shown first.
 * @param {Array} matches results of duplicateScore, each with `level`
 */
export function sortByConfidence(matches) {
  const order = { high: 0, medium: 1, low: 2 };
  return [...matches].sort((a, b) => order[a.level] - order[b.level]);
}
