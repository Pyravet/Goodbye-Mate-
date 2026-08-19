-- In-app notification centre (the bell), and soft-deletable messages.
--
-- Push notifications already exist, but they're fire-and-forget: if the
-- phone was off, permission was never granted, or the person simply
-- swiped it away, the notification is gone with no record. A bell needs
-- persisted notifications that survive being missed, can be marked read,
-- and link back to whatever they're about.

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  body TEXT,

  -- In-app path to open when tapped, e.g. '/jobs/<id>' or
  -- '/messages/<id>'. Stored as a relative path so the same row works
  -- across admin, vet web and native without rewriting.
  url TEXT,

  -- Coarse grouping for icons/filtering, e.g. 'message', 'job',
  -- 'payout'. Free text rather than an enum so adding a category later
  -- doesn't need a migration.
  category TEXT,

  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The bell reads "my unread, newest first" on nearly every poll, so the
-- index covers exactly that.
CREATE INDEX idx_notifications_user_unread
  ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX idx_notifications_user_recent
  ON notifications(user_id, created_at DESC);

-- Soft delete for messages.
--
-- Deliberately NOT a hard delete: these threads carry operational
-- decisions ("yes I can cover Thursday"), and letting either side
-- permanently erase them would make the record untrustworthy in a
-- dispute. The row stays; the body is simply hidden and replaced with a
-- tombstone in the UI.
ALTER TABLE conversation_messages ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE conversation_messages ADD COLUMN deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Per-participant conversation hiding. Removing a whole conversation
-- from YOUR inbox shouldn't remove it from the other person's, so this
-- is per-participant rather than a flag on the conversation itself.
ALTER TABLE conversation_participants ADD COLUMN hidden_at TIMESTAMPTZ;
