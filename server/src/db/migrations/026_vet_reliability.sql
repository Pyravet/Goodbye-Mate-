-- Vet reliability: a record of every dispatch offer and its outcome.
--
-- Until now an offer existed only as three columns on the job
-- (dispatch_offered_vet_id / dispatch_state / dispatch_expires_at),
-- which are OVERWRITTEN the moment the offer moves on. A vet could
-- decline twenty offers, or let them all time out, and there would be no
-- trace of it anywhere — work was being allocated with no data on who
-- actually turns up.
--
-- This table is append-only history, deliberately separate from the
-- job's current dispatch state.

CREATE TYPE vet_offer_outcome AS ENUM ('offered', 'accepted', 'declined', 'expired', 'withdrawn');

CREATE TABLE vet_job_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  vet_id UUID NOT NULL REFERENCES vets(id) ON DELETE CASCADE,

  outcome vet_offer_outcome NOT NULL DEFAULT 'offered',

  offered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,

  -- How long the vet took to respond, in seconds. Stored rather than
  -- derived so the figure can't drift if timestamps are ever corrected,
  -- and so response-time stats don't need a computation per row.
  response_seconds INT,

  -- Optional reason a vet gave for declining.
  decline_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vet_job_offers_vet ON vet_job_offers(vet_id, offered_at DESC);
CREATE INDEX idx_vet_job_offers_job ON vet_job_offers(job_id, offered_at DESC);

-- Cancellations AFTER a vet accepted are the most operationally damaging
-- event: a job that looked covered suddenly isn't, often close to the
-- visit. Tracked separately from declines, which are simply a vet saying
-- no up front — that's normal and shouldn't count against them the same
-- way.
CREATE TABLE vet_job_dropouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  vet_id UUID NOT NULL REFERENCES vets(id) ON DELETE CASCADE,

  -- Hours between the dropout and the scheduled visit. Negative means it
  -- happened after the appointment time. Short notice is what actually
  -- hurts, so this is the number worth surfacing.
  hours_before_visit NUMERIC(8,2),

  reason TEXT,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vet_job_dropouts_vet ON vet_job_dropouts(vet_id, created_at DESC);
