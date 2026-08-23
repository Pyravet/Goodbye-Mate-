/**
 * Cancellation fee calculation.
 *
 * Pure and DB-free so it can be tested directly, and so the admin UI can
 * preview the same number the server will charge without duplicating the
 * rule.
 */

/**
 * Hours between now and the appointment.
 *
 * Negative means the appointment time has already passed. Built from
 * date and time strings rather than Date arithmetic on a job row,
 * because job_date is a DATE and job_time a TIME and combining them via
 * local Date construction shifts under timezone — the same trap that put
 * jobs in the wrong calendar cell.
 *
 * @param {string|Date} jobDate 'YYYY-MM-DD'
 * @param {string} jobTime 'HH:MM' or 'HH:MM:SS'
 * @param {Date} [now]
 */
export function hoursUntilAppointment(jobDate, jobTime, now = new Date()) {
  const dateStr = jobDate instanceof Date
    ? jobDate.toISOString().slice(0, 10)
    : String(jobDate).slice(0, 10);
  const timeStr = String(jobTime || '00:00').slice(0, 5);
  const appointment = new Date(`${dateStr}T${timeStr}:00`);
  if (Number.isNaN(appointment.getTime())) return null;
  return (appointment.getTime() - now.getTime()) / 3600000;
}

/**
 * Which tier applies, and what it costs.
 *
 * Tiers are sorted most-notice-first and the first one the cancellation
 * still qualifies for wins. Sorting here rather than trusting the stored
 * order means an admin who adds a tier in the wrong place still gets
 * sensible behaviour instead of a silently wrong fee.
 *
 * @param {object} args
 * @param {number} args.billTotal what the client would have paid
 * @param {number|null} args.hoursNotice from hoursUntilAppointment()
 * @param {object} args.pricing pricing_settings config
 * @returns {{applies: boolean, fee: number, percent: number, label: string|null, reason: string}}
 */
export function cancellationFee({ billTotal, hoursNotice, pricing }) {
  const none = (reason) => ({ applies: false, fee: 0, percent: 0, label: null, reason });

  if (pricing?.cancellationPolicyEnabled !== true) {
    return none('Cancellation charges are turned off.');
  }
  if (hoursNotice === null || !Number.isFinite(hoursNotice)) {
    return none('The appointment time could not be read, so no fee was applied.');
  }

  const tiers = Array.isArray(pricing.cancellationTiers) ? [...pricing.cancellationTiers] : [];
  if (tiers.length === 0) return none('No cancellation tiers are configured.');

  tiers.sort((a, b) => Number(b.hoursBefore) - Number(a.hoursBefore));

  // A cancellation AFTER the appointment time is treated as the least
  // notice possible rather than falling through to no fee — someone who
  // simply didn't answer the door has cost the full slot.
  const notice = Math.max(hoursNotice, 0);

  const tier = tiers.find((t) => notice >= Number(t.hoursBefore)) || tiers[tiers.length - 1];
  const percent = Number(tier.percent) || 0;
  if (percent <= 0) {
    return { applies: false, fee: 0, percent: 0, label: tier.label || null, reason: 'No charge at this notice period.' };
  }

  const fee = Math.round(Number(billTotal || 0) * (percent / 100) * 100) / 100;
  return {
    applies: fee > 0,
    fee,
    percent,
    label: tier.label || `${percent}% fee`,
    reason: `${percent}% of ${formatAud(billTotal)} — ${tier.label || 'cancellation charge'}.`,
  };
}

function formatAud(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}
