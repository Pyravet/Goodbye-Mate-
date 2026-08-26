import { query } from '../db/pool.js';

/**
 * Multi-pet job helpers.
 *
 * job_pets is the source of truth for the pet list and per-pet consent.
 * jobs.pet_* mirrors the FIRST pet so the 39 files that read those
 * columns keep working. That mirror is maintained ONLY here — if it is
 * ever updated from somewhere else, the two will drift and the drift
 * will be invisible until a PDF names the wrong animal.
 */

/** All pets on a job, in display order. */
export async function getPets(jobId) {
  const { rows } = await query(
    `SELECT id, name, species, breed, weight, age, behaviour, service_type,
            consent_signed, consent_signature_name, consent_signed_at, sort_order
     FROM job_pets WHERE job_id = $1 ORDER BY sort_order, created_at`,
    [jobId]
  );
  return rows;
}

/**
 * Re-point jobs.pet_* at the first pet, and recompute job-level consent.
 *
 * Job consent means EVERY pet has been consented to. A job with two pets
 * where only one form is signed is not consented — treating it as such
 * would let the completion gate pass with a missing signature, which is
 * the one thing consent exists to prevent.
 */
export async function syncPrimaryPet(jobId) {
  const pets = await getPets(jobId);
  if (pets.length === 0) return null;

  const first = pets[0];
  // `every` on an empty array is true, hence the length check above —
  // otherwise a job with no pets would report itself fully consented.
  const allConsented = pets.every((p) => p.consent_signed);

  const { rows } = await query(
    `UPDATE jobs SET
       pet_name = $1, pet_type = $2, pet_breed = $3, pet_weight = $4,
       pet_age = $5, pet_behaviour = $6,
       consent_signed = $7,
       -- The job-level signature fields describe the FIRST pet's form.
       -- They exist for the older readers; the authoritative per-pet
       -- record is on job_pets.
       consent_signature_name = $8,
       consent_signed_at = $9,
       updated_at = now()
     WHERE id = $10
     RETURNING *`,
    [
      first.name, first.species, first.breed, first.weight,
      first.age, first.behaviour,
      allConsented,
      first.consent_signature_name, first.consent_signed_at,
      jobId,
    ]
  );
  return rows[0];
}

/**
 * How many pets still need a signature.
 * Used to tell the client what's left rather than a bare "not signed".
 */
export function outstandingConsents(pets) {
  return pets.filter((p) => !p.consent_signed);
}
