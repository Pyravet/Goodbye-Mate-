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

/**
 * The first pet's signature IMAGE.
 *
 * Separate from getPets because the image is a BYTEA that most callers
 * — the admin list, the client journey, the pets card — never need, and
 * shipping it on every read would bloat those responses for nothing.
 */
async function firstPetSignature(jobId) {
  const { rows } = await query(
    `SELECT consent_signature_image FROM job_pets
     WHERE job_id = $1 ORDER BY sort_order, created_at LIMIT 1`,
    [jobId]
  );
  return rows[0]?.consent_signature_image || null;
}

/**
 * Create the first pet row for a newly created job.
 *
 * MUST be called from every path that creates a job. There are two —
 * the admin New Booking form and converting a booking request — and the
 * step was missed in both at different times, each producing jobs whose
 * clients could not sign consent at all. Centralised here so there is
 * one thing to call rather than a block to remember to copy.
 *
 * @param {object} job the freshly inserted job row
 */
export async function createFirstPet(job) {
  const { rows } = await query(
    `INSERT INTO job_pets (job_id, name, species, breed, weight, age, behaviour, service_type, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0)
     RETURNING *`,
    [job.id, job.pet_name, job.pet_type, job.pet_breed, job.pet_weight,
     job.pet_age, job.pet_behaviour, job.service_type]
  );
  return rows[0];
}

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

  // The signature IMAGE has to be mirrored too. Without it the consent
  // PDF read jobs.consent_signature_image, which nothing writes any
  // more, and rendered "No drawn signature was captured" on every job —
  // a consent document with no signature on it.
  const signatureImage = await firstPetSignature(jobId);

  const { rows } = await query(
    `UPDATE jobs SET
       pet_name = $1, pet_type = $2, pet_breed = $3, pet_weight = $4,
       pet_age = $5, pet_behaviour = $6,
       consent_signed = $7,
       -- The job-level signature fields describe the FIRST pet's form.
       -- They exist for the older readers; the authoritative per-pet
       -- record is on job_pets.
       consent_signature_name = $8,
       consent_signature_image = $9,
       consent_signed_at = $10,
       updated_at = now()
     WHERE id = $11
     RETURNING *`,
    [
      // pet_name, pet_type and pet_behaviour are NOT NULL on jobs, but
      // the equivalent job_pets columns are optional — species and
      // breed are genuinely unknown sometimes. Mirroring a null would
      // throw and take the whole request with it, so a pet added
      // without a species would break the job it was added to.
      first.name,
      first.species || 'Unknown',
      first.breed, first.weight, first.age,
      first.behaviour || 'Friendly',
      allConsented,
      first.consent_signature_name, signatureImage, first.consent_signed_at,
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
