-- Ad-hoc charges and discounts on a job.
--
-- Pricing until now was fixed: a service, a transfer fee, and a handful
-- of hardcoded surcharges. Real jobs need one-off additions (extra
-- travel, a large dog needing two people, extra time on site, an
-- aggressive patient needing sedation) and occasional discounts
-- (goodwill, hardship, referral).
--
-- Modelled as a generic line-item table rather than more columns on
-- jobs, so admin can add charges we haven't thought of without a
-- migration each time. Discounts are the same rows with a negative
-- amount, which keeps the bill maths a single sum instead of two
-- code paths that can disagree.
CREATE TABLE job_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  -- Positive = extra charge, negative = discount. Stored in dollars to
  -- match the rest of the pricing config (which is also dollars, not
  -- cents) — mixing units here would be a bug factory.
  amount NUMERIC(10,2) NOT NULL,
  -- What the vet is paid for this item, if anything. An extra-travel
  -- charge usually passes through to the vet; a goodwill discount does
  -- not reduce their payout.
  vet_payout NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_job_line_items_job ON job_line_items(job_id);

-- Admin notes visible to the assigned vet. Distinct from jobs.notes
-- (client-supplied booking notes: gate codes, parking) and from
-- medical_notes (the vet's own private clinical record). This is the
-- operational channel: "client's daughter will be present", "park in
-- the rear lane".
ALTER TABLE jobs ADD COLUMN admin_notes TEXT;

-- Cancellation context. The 'cancelled' status already existed in the
-- job_status enum but had no route, no UI and no way to record why.
ALTER TABLE jobs ADD COLUMN cancelled_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN cancellation_reason TEXT;
