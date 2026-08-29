-- Record when a client was last nudged, and about what.
--
-- Admin can text a client a link at any time. Without a record, two
-- people looking at the same job both press send and a grieving family
-- gets the same message twice — so the UI needs to be able to say "sent
-- 20 minutes ago" before someone clicks again.
ALTER TABLE jobs ADD COLUMN last_nudge_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN last_nudge_kind TEXT;
