-- Cancellation policy.
--
-- Cancelling a job did nothing about money: no fee, no refund, no
-- record. A same-day cancellation costs a held vet slot that can't be
-- refilled, and that was being absorbed silently or worked out by hand
-- on each occasion.
--
-- The TIERS are admin-configurable, not hardcoded. What's fair depends
-- on the business, and it will change — a fixed 24h/50% rule in code
-- means a deploy every time that judgement moves.
ALTER TABLE jobs ADD COLUMN cancellation_fee NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN cancellation_fee_waived BOOLEAN NOT NULL DEFAULT false;

UPDATE pricing_settings
SET config = jsonb_set(
      jsonb_set(
        config,
        '{cancellationPolicyEnabled}',
        COALESCE(config->'cancellationPolicyEnabled', 'false'::jsonb),
        true
      ),
      '{cancellationTiers}',
      COALESCE(config->'cancellationTiers', jsonb_build_array(
        -- Ordered most-notice first; the engine picks the first tier
        -- whose hoursBefore threshold the cancellation still meets.
        -- percent is of the client's total bill.
        jsonb_build_object('hoursBefore', 24, 'percent', 0,
                           'label', 'More than 24 hours notice'),
        jsonb_build_object('hoursBefore', 4,  'percent', 50,
                           'label', '4 to 24 hours notice'),
        jsonb_build_object('hoursBefore', 0,  'percent', 100,
                           'label', 'Less than 4 hours notice')
      )),
      true
    )
WHERE id = true;

-- Defaults to DISABLED. Charging a cancellation fee to someone who has
-- just decided not to go ahead — often because the pet died naturally
-- overnight — is a decision the business must make deliberately, not
-- something that switches itself on during a deploy.
