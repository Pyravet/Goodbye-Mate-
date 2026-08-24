-- Password reset.
--
-- There was no way to recover an account. A vet who forgets their
-- password had to ask admin to change it for them, and an admin who
-- forgot theirs had no route back in at all — for a sole admin that
-- means losing access to the whole business.
--
-- Tokens are stored HASHED, exactly like refresh tokens. A readable
-- reset token in the database is a working key to any account: anyone
-- who can read the table could take over an admin login without ever
-- knowing the password.
CREATE TABLE password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  token_hash TEXT NOT NULL UNIQUE,

  -- Short-lived on purpose. A reset link sits in an inbox indefinitely,
  -- and an old one still working means a compromised mailbox is a
  -- compromised account months later.
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,

  -- Kept for abuse investigation only.
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup is always "find this unused token", which is a narrow slice.
CREATE INDEX idx_password_resets_lookup
  ON password_resets (token_hash) WHERE used_at IS NULL;
