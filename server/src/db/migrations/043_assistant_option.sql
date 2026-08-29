-- "Nobody can help" is an option to price, not a dead end.
--
-- A family who can't lift their own dog shouldn't simply be turned away.
-- There are two things we can offer, and both cost something:
--
--   direct_pickup  the crematorium partner sends their own driver and
--                  bills the client directly. Our transfer fee comes
--                  off, since we aren't doing that work.
--   assistant      we send a second person with the vet. That is real
--                  labour and is charged for.
--
-- 'needs_help' stays, but now means "asked for help and hasn't chosen
-- yet" — a state admin must resolve, not an outcome.

-- Converted from an enum rather than extended: ALTER TYPE ... ADD VALUE
-- cannot run inside a transaction block, and this runner wraps every
-- migration in one. Same approach as migrations 030 and 040, and the
-- last option needed adding will be a one-line change.
ALTER TABLE jobs ALTER COLUMN handling_help TYPE TEXT;
ALTER TABLE jobs ALTER COLUMN handling_help SET DEFAULT 'not_needed';
ALTER TABLE jobs ADD CONSTRAINT jobs_handling_help_check
  CHECK (handling_help IN ('not_needed', 'client_helps', 'direct_pickup', 'needs_help', 'assistant'));

ALTER TABLE booking_requests ALTER COLUMN handling_help TYPE TEXT;
ALTER TABLE booking_requests ADD CONSTRAINT booking_requests_handling_help_check
  CHECK (handling_help IS NULL OR handling_help IN
    ('not_needed', 'client_helps', 'direct_pickup', 'needs_help', 'assistant'));

DROP TYPE IF EXISTS job_handling_help;

-- What a second person costs. Admin-editable because it depends on who
-- is available and what they're paid — a nurse on a quiet Tuesday and
-- someone called in on a Sunday are not the same cost.
UPDATE pricing_settings
SET config = jsonb_set(
      config, '{assistantFee}',
      COALESCE(config->'assistantFee', jsonb_build_object(
        'clientPrice', 90,
        -- Paid to the vet, who arranges and pays the assistant.
        'vetPayout', 70
      )),
      true
    )
WHERE id = true;
