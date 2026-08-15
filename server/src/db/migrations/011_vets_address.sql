-- 011_vets_address.sql
-- Address wasn't previously captured for vets (only postcodes for
-- territory matching, which is a different thing — a vet's coverage
-- area isn't necessarily their home address). Needed for the self-signup
-- flow's "personal details" step.

ALTER TABLE vets
  ADD COLUMN address TEXT,
  ADD COLUMN suburb TEXT,
  ADD COLUMN postcode TEXT,
  ADD COLUMN state TEXT;
