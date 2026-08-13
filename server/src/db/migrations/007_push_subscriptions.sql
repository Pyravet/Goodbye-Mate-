-- 007_push_subscriptions.sql
-- Web Push subscriptions, one row per device a user has enabled
-- notifications on (a vet might have it on both their phone and a tablet).

CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  subscription JSONB NOT NULL, -- the full PushSubscription object (endpoint + keys)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions(user_id);
