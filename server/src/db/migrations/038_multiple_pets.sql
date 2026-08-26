-- Multiple pets on one job.
--
-- Families sometimes say goodbye to two or three animals in the same
-- visit — often elderly littermates. Until now a job held exactly one
-- pet, so this meant creating separate bookings for the same address and
-- time, which double-dispatches, double-charges and produces two
-- unrelated consent forms for one appointment.
--
-- EACH PET NEEDS ITS OWN SIGNED CONSENT. Consent is a decision about a
-- specific animal; a single signature covering "the pets" is not a
-- record anyone should rely on if it is ever questioned.
--
-- DESIGN NOTE — deliberately NOT a full normalisation.
--
-- 39 files read jobs.pet_name and friends: PDFs, SMS templates, exports,
-- dispatch, the calendar, the client journey. Moving all of them at once,
-- with route tests covering only the money paths, would be a large
-- untested change to the most-read table in the system.
--
-- Instead: job_pets is the source of truth for the pet LIST and for
-- per-pet consent, and jobs.pet_* remains a mirror of the FIRST pet.
-- Everything that exists keeps working untouched; anything that needs
-- the full list reads job_pets. The mirror is maintained in one place
-- (syncPrimaryPet in domain/jobPets.js) so it cannot drift silently.
CREATE TABLE job_pets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  species TEXT,
  breed TEXT,
  weight TEXT,
  age TEXT,
  behaviour TEXT DEFAULT 'Friendly',

  -- Service type is per-pet: a family may choose private cremation for
  -- one animal and communal for another, and forcing one choice across
  -- both would misprice the job and mishandle the remains.
  service_type job_service_type,

  -- Consent, per pet.
  consent_signed BOOLEAN NOT NULL DEFAULT false,
  consent_signature_name TEXT,
  consent_signature_image BYTEA,
  consent_signed_at TIMESTAMPTZ,

  -- Ordering for display and for deciding which pet mirrors to jobs.*.
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_pets_job ON job_pets (job_id, sort_order);

-- Backfill: every existing job becomes a one-pet job, carrying its
-- existing consent across so nothing already signed is lost.
INSERT INTO job_pets (
  job_id, name, species, breed, weight, age, behaviour, service_type,
  consent_signed, consent_signature_name, consent_signature_image,
  consent_signed_at, sort_order
)
SELECT
  id, COALESCE(pet_name, 'Pet'), pet_type, pet_breed, pet_weight, pet_age,
  COALESCE(pet_behaviour, 'Friendly'), service_type,
  consent_signed, consent_signature_name, consent_signature_image,
  consent_signed_at, 0
FROM jobs;
