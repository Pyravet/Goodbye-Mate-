-- Pause notifications, rather than unsubscribe.
--
-- The only existing control DELETED the push subscription. A vet who
-- wanted quiet overnight would have to re-register the device
-- afterwards — and if they didn't, they'd stop receiving offers
-- permanently without realising, which costs them work and looks like
-- the app being broken.
--
-- A pause with an end time is the thing they actually want: quiet now,
-- back on automatically.
ALTER TABLE users
  -- NULL means notifications are on. A timestamp means paused until
  -- then. Stored as an expiry rather than a boolean so it CANNOT be
  -- left off by accident — the worst outcome here is a vet silently
  -- missing every offer for a week.
  ADD COLUMN notifications_paused_until TIMESTAMPTZ;

-- Quiet hours: a nightly window during which nothing is pushed.
--
-- Distinct from the pause above, which is a one-off. A vet who never
-- wants a 3am notification shouldn't have to remember to pause every
-- evening.
ALTER TABLE users
  ADD COLUMN quiet_hours_start SMALLINT CHECK (quiet_hours_start BETWEEN 0 AND 23),
  ADD COLUMN quiet_hours_end SMALLINT CHECK (quiet_hours_end BETWEEN 0 AND 23);
