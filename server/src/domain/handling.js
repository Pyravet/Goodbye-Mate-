/**
 * Handling arrangements — who carries the pet, and what that costs.
 *
 * Pure and DB-free so the rules are testable and so the booking forms
 * can show the same figures the server will charge.
 */

/**
 * Read a weight in kilograms out of the free-text field.
 *
 * pet_weight is a TEXT column filled in by whoever took the booking, so
 * it arrives as "35", "35kg", "35 kg", "approx 35kg", "35.5". Parsing
 * has to be forgiving, because the consequence of failing is a vet
 * turning up alone to lift an animal they weren't warned about.
 *
 * Returns null when no number can be found — the caller must treat that
 * as "unknown", never as "light".
 *
 * @param {string|number|null} value
 * @returns {number|null} kilograms
 */
export function parseWeightKg(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const text = String(value).toLowerCase();

  // Grams, when someone writes "800g" for a cat or rabbit.
  const grams = text.match(/(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/);
  if (grams && !/kg/.test(text)) return Number(grams[1]) / 1000;

  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Must this job be assigned by a human rather than auto-dispatched?
 *
 * A vet works alone. Before accepting a large animal they need to know
 * the weight AND whether anyone at the home can help carry it — that's
 * a conversation, not something to spring on them via an automated
 * offer they have minutes to answer.
 *
 * An UNKNOWN weight also blocks: the honest response to "we don't know
 * how heavy it is" is for a person to find out, not to assume it's fine.
 *
 * @param {object} job
 * @param {object} pricing pricing_settings config
 * @param {Array<{name:string, weight:string}>} [pets] every pet on the
 *   visit. Without it this reads job.pet_weight, which mirrors only the
 *   FIRST pet — so a 5kg cat booked alongside a 45kg dog looked light
 *   and went out automatically, with nothing warning the vet.
 * @returns {{manual: boolean, reason: string|null, weightKg: number|null}}
 */
export function requiresManualDispatch(job, pricing, pets) {
  const threshold = Number(pricing?.manualDispatchWeightKg) || 30;

  // Weigh EVERY animal, not the mirrored one. The heaviest decides,
  // because that's the one the vet has to lift.
  const list = (pets?.length ? pets : [{ name: job?.pet_name, weight: job?.pet_weight }])
    .map((p) => ({ name: p.name, kg: parseWeightKg(p.weight) }));

  const unknown = list.filter((p) => p.kg == null);
  if (unknown.length > 0) {
    const who = unknown.map((p) => p.name).filter(Boolean).join(', ');
    return {
      manual: true,
      reason: list.length > 1 && who
        ? `No weight recorded for ${who}, so we can't tell whether help is needed to carry them.`
        : "The pet's weight isn't recorded, so we can't tell whether help is needed to carry them.",
      weightKg: null,
    };
  }

  const heaviest = list.reduce((a, b) => (b.kg > a.kg ? b : a));
  const weightKg = heaviest.kg;

  if (weightKg >= threshold) {
    return {
      manual: true,
      reason: `${list.length > 1 && heaviest.name ? `${heaviest.name} is ` : 'This pet is '}`
        + `${weightKg}kg, over the ${threshold}kg limit for automatic offers — `
        + 'a vet needs to know what they are taking on before they accept.',
      weightKg,
    };
  }

  // 'needs_help' means the family has said nobody can lift the pet and
  // hasn't yet chosen between a direct pickup and us sending a second
  // person. It's an unresolved decision, not an outcome — and until
  // it's resolved the visit can't be costed or staffed, so it must not
  // be offered as though it were a normal job.
  if (job?.handling_help === 'needs_help') {
    return {
      manual: true,
      reason: 'Nobody at the home can lift the pet. Agree a direct pickup or an extra person with '
        + 'the client before booking a vet.',
      weightKg,
    };
  }

  return { manual: false, reason: null, weightKg };
}

/**
 * Does OUR transfer fee apply?
 *
 * With a direct pickup the crematorium partner sends their own driver
 * and bills the client themselves. Charging our transfer fee as well
 * would be charging for work we are not doing.
 *
 * @param {object} job
 */
export function chargesTransferFee(job) {
  return job?.handling_help !== 'direct_pickup';
}

/**
 * Are we sending a second person with the vet?
 *
 * Real labour, so it's charged for — and the vet is paid a share, since
 * they arrange and pay the assistant.
 */
export function chargesAssistantFee(job) {
  return job?.handling_help === 'assistant';
}

export const HANDLING_LABELS = {
  not_needed: 'No transport needed',
  client_helps: 'Someone at home will help carry',
  direct_pickup: 'Crematorium partner collects directly',
  assistant: 'We send a second person to help',
  // Deliberately worded as unresolved: it needs a decision from admin,
  // it is not a valid final state for a booking.
  needs_help: 'NOBODY CAN HELP — needs resolving',
};

export const PACE_LABELS = {
  slow: 'Slow and unhurried',
  normal: 'Normal pace',
  quick: 'Keep it brief',
};
