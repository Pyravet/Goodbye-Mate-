-- Weekly vet payouts and period-based RCTIs.
--
-- Until now an RCTI was generated per JOB, on demand, with no record
-- that it was ever issued. That doesn't match how vets are actually
-- paid (weekly, one payment covering every job in the period) and it
-- doesn't satisfy what a recipient-created tax invoice needs: a stable,
-- unique, non-reusable document number, and an immutable record of what
-- was invoiced.
--
-- Design notes:
--  * A period is created once and then FROZEN. Job payout figures are
--    copied into vet_payout_period_items at approval time rather than
--    recomputed later, because pricing settings and job line items can
--    change afterwards — and an issued tax document must not silently
--    change with them.
--  * Week start day is configurable (see settings.payoutWeekStartDay),
--    but changing it only affects periods generated from then on;
--    already-created periods keep their original boundaries.

CREATE TYPE vet_payout_status AS ENUM ('draft', 'approved', 'paid');

CREATE TABLE vet_payout_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vet_id UUID NOT NULL REFERENCES vets(id) ON DELETE CASCADE,

  -- Inclusive date range, in Australian local dates (not UTC).
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  status vet_payout_status NOT NULL DEFAULT 'draft',

  -- Sequential, human-readable RCTI number, assigned at APPROVAL time
  -- (not at draft), so drafts that are never approved don't burn a
  -- number and leave gaps in the sequence.
  rcti_number TEXT UNIQUE,

  -- Frozen totals, in dollars. Copied at approval; never recomputed.
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  gst NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,

  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One period per vet per week.
  UNIQUE (vet_id, period_start)
);

CREATE INDEX idx_payout_periods_vet ON vet_payout_periods(vet_id, period_start DESC);
CREATE INDEX idx_payout_periods_status ON vet_payout_periods(status, period_start DESC);

-- The frozen line detail behind a period's total: one row per job, with
-- the payout figures as they stood when the period was approved.
CREATE TABLE vet_payout_period_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES vet_payout_periods(id) ON DELETE CASCADE,

  -- SET NULL rather than CASCADE: deleting a job must not silently
  -- alter the total of an already-issued tax document.
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,

  -- Denormalised deliberately, so the RCTI can still be reproduced
  -- exactly even if the job is later edited or removed.
  job_number TEXT NOT NULL,
  job_date DATE NOT NULL,
  pet_name TEXT,
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL
);

CREATE INDEX idx_payout_period_items_period ON vet_payout_period_items(period_id);

-- Counter for RCTI numbering. A dedicated table (rather than deriving
-- MAX(rcti_number)+1) so allocation can take a row lock and two
-- concurrent approvals can't be handed the same number.
CREATE TABLE rcti_sequence (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  next_number INT NOT NULL DEFAULT 1,
  prefix TEXT NOT NULL DEFAULT 'RCTI-'
);
INSERT INTO rcti_sequence (id) VALUES (true);
