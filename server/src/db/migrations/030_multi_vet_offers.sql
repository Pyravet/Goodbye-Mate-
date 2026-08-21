-- Offers to MULTIPLE vets at once, and vet-proposed alternative times.
--
-- The existing model offers a job to ONE vet at a time and rolls to the
-- next when it expires. That's slow when a job needs covering quickly,
-- and it hides the job from vets who could have taken it.
--
-- vet_job_offers already records every offer as history. It now doubles
-- as the source of truth for ACTIVE offers: any row with
-- outcome = 'offered' is a live offer to that vet. The job's single
-- dispatch_offered_vet_id column is kept for backward compatibility
-- (it holds whoever accepted) but is no longer what decides visibility.

-- Each offer gets its own expiry, so offers made at different times
-- don't all lapse together.
ALTER TABLE vet_job_offers ADD COLUMN expires_at TIMESTAMPTZ;

-- A vet can propose a different time instead of a flat decline. This is
-- a SUGGESTION, not a booking: admin still has to agree it with the
-- client, because the client may have arranged family around the
-- original time.
ALTER TABLE vet_job_offers ADD COLUMN proposed_date DATE;
ALTER TABLE vet_job_offers ADD COLUMN proposed_time TIME;
ALTER TABLE vet_job_offers ADD COLUMN proposal_note TEXT;

-- 'proposed' sits alongside accepted/declined/expired: the vet has
-- responded, but with a counter-offer rather than a yes or no.
--
-- NOT done with ALTER TYPE ... ADD VALUE: that cannot run inside a
-- transaction block, and this runner wraps every migration in one, so it
-- would fail outright. Converting the column to TEXT with a CHECK gives
-- the same guarantee, and makes future outcomes a one-line change rather
-- than another enum migration.
ALTER TABLE vet_job_offers ALTER COLUMN outcome TYPE TEXT;
ALTER TABLE vet_job_offers ALTER COLUMN outcome SET DEFAULT 'offered';
ALTER TABLE vet_job_offers
  ADD CONSTRAINT vet_job_offers_outcome_check
  CHECK (outcome IN ('offered', 'accepted', 'declined', 'expired', 'withdrawn', 'proposed'));

-- The vet's offers screen reads "my live offers" on every load.
CREATE INDEX idx_vet_job_offers_active
  ON vet_job_offers(vet_id, outcome)
  WHERE outcome IN ('offered', 'proposed');
