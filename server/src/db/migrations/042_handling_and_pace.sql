-- Handling arrangements and appointment pace.
--
-- Three things nobody was asking, each of which decides whether a visit
-- can actually go ahead:
--
-- 1. WHO CARRIES THE PET. A vet works alone. If the pet is large and
--    nobody at the house can help, and no direct pickup is arranged,
--    there is physically no way to complete the job — which is a
--    dreadful thing to discover on the doorstep.
--
-- 2. DIRECT PICKUP. The crematorium partner sends their own driver and
--    bills the client directly, so OUR transfer fee must come off. We
--    are not doing that work.
--
-- 3. PACE. Some families want time to sit with their pet; others find a
--    drawn-out visit unbearable. The vet can only pace it if told.

-- 'client_helps'   someone at the home will help carry the pet out
-- 'direct_pickup'  the crematorium partner collects and bills directly
-- 'needs_help'     nobody can help — we must arrange assistance, and if
--                  we cannot, the job cannot proceed
-- 'not_needed'     small pet, or euthanasia only with no transport
CREATE TYPE job_handling_help AS ENUM
  ('not_needed', 'client_helps', 'direct_pickup', 'needs_help');

-- 'slow' means a longer, unhurried visit. Recorded as a preference the
-- vet is told about, not a priced product — a family shouldn't have to
-- pay more to be allowed to say goodbye properly.
CREATE TYPE job_pace AS ENUM ('slow', 'normal', 'quick');

ALTER TABLE jobs
  ADD COLUMN handling_help job_handling_help NOT NULL DEFAULT 'not_needed',
  ADD COLUMN pace job_pace NOT NULL DEFAULT 'normal',
  -- Free text for anything the two enums don't capture — a narrow
  -- staircase, a nervous dog, no parking.
  ADD COLUMN handling_notes TEXT;

-- Same questions on a public enquiry, so the answers arrive with the
-- request rather than being chased later.
ALTER TABLE booking_requests
  ADD COLUMN handling_help job_handling_help,
  ADD COLUMN pace job_pace,
  ADD COLUMN handling_notes TEXT;

-- The weight above which a job must NOT be auto-dispatched.
--
-- A vet needs to know before accepting that they'll be lifting a large
-- animal, and whether anyone will help. Configurable rather than
-- hardcoded because it depends on the roster.
UPDATE pricing_settings
SET config = jsonb_set(
      config, '{manualDispatchWeightKg}',
      COALESCE(config->'manualDispatchWeightKg', '30'::jsonb),
      true
    )
WHERE id = true;
