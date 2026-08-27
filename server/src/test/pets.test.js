import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../db/pool.js';
import { getPets, syncPrimaryPet, outstandingConsents } from '../domain/jobPets.js';
import { resetDb, createJob, closeDb } from './helpers.js';

/**
 * Multi-pet consent, against a real database.
 *
 * jobs.pet_* mirrors the FIRST pet so that 39 files reading those
 * columns keep working. That mirror is the single point of failure for
 * the whole feature — and it shipped untested, which is how two
 * regressions reached production:
 *
 *   - the signature IMAGE was never mirrored, so every consent PDF
 *     rendered "No drawn signature was captured"
 *   - a pet added without a species violated jobs.pet_type NOT NULL and
 *     broke the job it was added to
 *
 * Both are covered below.
 */

before(async () => { await resetDb(); });
beforeEach(async () => { await resetDb(); });
after(async () => { await closeDb(); });

async function addPet(jobId, name, order, extra = {}) {
  const { rows } = await query(
    `INSERT INTO job_pets (job_id, name, species, sort_order, consent_signed,
       consent_signature_name, consent_signature_image)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [jobId, name, extra.species ?? 'Dog', order, extra.signed ?? false,
     extra.signatureName ?? null, extra.signatureImage ?? null]
  );
  return rows[0];
}

test('job consent is true ONLY when every pet is signed', async () => {
  const job = await createJob();
  await addPet(job.id, 'Bella', 0);
  await addPet(job.id, 'Max', 1);
  await addPet(job.id, 'Rex', 2);

  let j = await syncPrimaryPet(job.id);
  assert.equal(j.consent_signed, false, 'none signed');

  const pets = await getPets(job.id);
  await query('UPDATE job_pets SET consent_signed = true WHERE id = $1', [pets[0].id]);
  j = await syncPrimaryPet(job.id);
  assert.equal(j.consent_signed, false, 'one of three must NOT count as consented');

  await query('UPDATE job_pets SET consent_signed = true WHERE id = $1', [pets[1].id]);
  j = await syncPrimaryPet(job.id);
  assert.equal(j.consent_signed, false, 'two of three still not consented');

  await query('UPDATE job_pets SET consent_signed = true WHERE id = $1', [pets[2].id]);
  j = await syncPrimaryPet(job.id);
  assert.equal(j.consent_signed, true, 'all three signed');
});

test('the signature IMAGE is mirrored onto the job', async () => {
  // The regression: the PDF reads jobs.consent_signature_image, which
  // nothing wrote after consent moved to job_pets, so every consent
  // document came out with no signature on it.
  const job = await createJob();
  const sig = Buffer.from('fake-png-bytes');
  await addPet(job.id, 'Bella', 0, { signed: true, signatureName: 'Owner', signatureImage: sig });

  const j = await syncPrimaryPet(job.id);
  assert.ok(j.consent_signature_image, 'image must be mirrored, not left null');
  assert.equal(Buffer.compare(j.consent_signature_image, sig), 0, 'bytes must match exactly');
  assert.equal(j.consent_signature_name, 'Owner');
});

test('a pet with no species does not break the job', async () => {
  // jobs.pet_type is NOT NULL but job_pets.species is optional —
  // species is genuinely unknown sometimes. Mirroring null threw and
  // took the whole request with it.
  const job = await createJob();
  await addPet(job.id, 'Bella', 0, { species: null });

  const j = await syncPrimaryPet(job.id);
  assert.ok(j.pet_type, 'must substitute rather than write null');
  assert.equal(j.pet_name, 'Bella');
});

test('the mirror always follows the FIRST pet by sort order', async () => {
  const job = await createJob();
  // Inserted out of order on purpose: sort_order decides, not insertion.
  await addPet(job.id, 'Max', 1);
  await addPet(job.id, 'Bella', 0);

  const j = await syncPrimaryPet(job.id);
  assert.equal(j.pet_name, 'Bella', 'lowest sort_order is the primary pet');
});

test('deleting a job removes its pets', async () => {
  const job = await createJob();
  await addPet(job.id, 'Bella', 0);
  await query('DELETE FROM jobs WHERE id = $1', [job.id]);

  const { rows } = await query('SELECT count(*)::int AS c FROM job_pets WHERE job_id = $1', [job.id]);
  assert.equal(rows[0].c, 0, 'orphaned consent records must not survive the job');
});

test('outstandingConsents lists exactly the unsigned pets', async () => {
  const job = await createJob();
  await addPet(job.id, 'Bella', 0, { signed: true });
  await addPet(job.id, 'Max', 1);
  await addPet(job.id, 'Rex', 2);

  const outstanding = outstandingConsents(await getPets(job.id));
  assert.deepEqual(outstanding.map((p) => p.name), ['Max', 'Rex']);
});

test('a single-pet job behaves exactly as before', async () => {
  // The whole design rests on not disturbing existing bookings.
  const job = await createJob();
  const sig = Buffer.from('sig');
  await addPet(job.id, 'Bella', 0, { signed: true, signatureName: 'Owner', signatureImage: sig });

  const j = await syncPrimaryPet(job.id);
  assert.equal(j.consent_signed, true);
  assert.equal(j.pet_name, 'Bella');
  assert.ok(j.consent_signature_image);
});
