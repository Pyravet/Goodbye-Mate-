-- 008_expo_push_tokens.sql
-- Native app push tokens (Expo's push service), separate from the web
-- push_subscriptions table since the payload shape and delivery API are
-- completely different (Expo push API vs raw Web Push).

CREATE TABLE expo_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expo_push_tokens_user_id ON expo_push_tokens(user_id);
