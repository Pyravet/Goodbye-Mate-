-- Standalone messaging: conversations between admin and vets that
-- aren't tied to a specific job.
--
-- This is deliberately SEPARATE from job_internal_messages, which stays
-- as the per-job thread (a message about a specific booking belongs on
-- that booking, and merging the two would bury operational context).
-- What's missing today is a general inbox: message one vet, add more
-- people to a conversation, or message several vets at once and get
-- each reply back SEPARATELY rather than in a group thread.
--
-- The "separate replies" requirement drives the core design decision:
-- a broadcast does not create one shared conversation. It fans out into
-- one conversation per recipient, linked by broadcast_id. Each vet then
-- sees only their own thread and cannot see who else received it or
-- what they said — which is what you want when asking several vets
-- "can you cover Thursday?".

CREATE TYPE conversation_kind AS ENUM ('direct', 'group', 'broadcast_child');

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 'direct'          one-to-one
  -- 'group'           a named channel with several participants who all
  --                   see each other's messages
  -- 'broadcast_child' one of the per-recipient threads produced by a
  --                   broadcast; behaves like a direct conversation
  kind conversation_kind NOT NULL DEFAULT 'direct',

  -- Only meaningful for groups. Direct threads are labelled in the UI
  -- from the other participant's name, so a stored subject would just
  -- go stale when someone's name changes.
  subject TEXT,

  -- Groups the per-recipient threads created by one broadcast, so admin
  -- can see "5 replies to the Thursday cover request" in one place.
  broadcast_id UUID,

  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Denormalised for inbox ordering. Sorting by a subquery over
  -- messages would mean a scan per conversation on every inbox load.
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_last_message ON conversations(last_message_at DESC);
CREATE INDEX idx_conversations_broadcast ON conversations(broadcast_id) WHERE broadcast_id IS NOT NULL;

CREATE TABLE conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Per-participant read state. Stored as a timestamp rather than a
  -- boolean so unread COUNTS are a simple comparison against message
  -- created_at, and adding someone to an existing group doesn't mark
  -- the whole history unread for them.
  last_read_at TIMESTAMPTZ,

  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_conversation_participants_user ON conversation_participants(user_id);

CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  -- SET NULL keeps the message readable if the author is deleted;
  -- sender_name preserves attribution regardless.
  sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,

  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversation_messages_conv ON conversation_messages(conversation_id, created_at);
