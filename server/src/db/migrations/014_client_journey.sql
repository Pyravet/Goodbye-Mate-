-- Client journey: a per-job unguessable token that lets the client view
-- a public (no-login) page covering the process, consent, payment, and
-- aftercare info, without exposing any other job's data. Also captures
-- the consent signature itself, and unread-message flags so admin/vet
-- job lists can show a "new message" indicator without polling.

ALTER TABLE jobs ADD COLUMN client_token UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE jobs ADD COLUMN consent_signature_name TEXT;
ALTER TABLE jobs ADD COLUMN consent_signed_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN journey_link_sent_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN admin_unread_messages BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN vet_unread_messages BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX idx_jobs_client_token ON jobs(client_token);
