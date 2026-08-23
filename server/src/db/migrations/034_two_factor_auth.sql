-- Two-factor authentication (TOTP).
--
-- Admin accounts guard payment data, encrypted bank details and
-- health-adjacent clinical records behind a single password. TOTP is the
-- cheapest meaningful improvement: no SMS costs, no delivery failures,
-- works offline, and every authenticator app already supports it.
--
-- The secret is encrypted at rest using the same key as bank details.
-- A plaintext TOTP secret in the database is equivalent to storing the
-- second factor next to the first — anyone reading the table could
-- generate valid codes.
ALTER TABLE users ADD COLUMN totp_secret_enc TEXT;

-- Separate from the secret existing: a secret is written during setup,
-- but 2FA only takes effect once the user has proven they can generate a
-- correct code. Otherwise a botched setup locks them out of their own
-- account.
ALTER TABLE users ADD COLUMN totp_enabled_at TIMESTAMPTZ;

-- Single-use recovery codes, stored as bcrypt hashes in a JSON array.
-- Hashed for the same reason passwords are: they ARE a password, and a
-- readable list of them defeats the whole mechanism.
ALTER TABLE users ADD COLUMN totp_recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Short-lived tokens issued between password check and code entry, so
-- the password isn't re-sent and a half-finished login can't be resumed
-- days later.
CREATE TABLE totp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_totp_challenges_hash ON totp_challenges(token_hash) WHERE consumed_at IS NULL;
