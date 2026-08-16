-- Tracks the vet's most recent "I'm on the way" notification for a job,
-- so admin can see at a glance whether/when the client was told an ETA.
ALTER TABLE jobs ADD COLUMN en_route_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN en_route_eta_minutes INTEGER;
ALTER TABLE jobs ADD COLUMN en_route_distance_text TEXT;
