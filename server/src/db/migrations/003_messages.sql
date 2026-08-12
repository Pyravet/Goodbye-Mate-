-- 003_messages.sql
-- Generic outbound message pipeline: covers SMS now, WhatsApp/email once
-- those credentials land. One row per outbound message, regardless of
-- channel, so the Enquiries inbox (Phase 3) can show one unified thread.

CREATE TYPE message_channel AS ENUM ('sms', 'whatsapp', 'email');

CREATE TYPE message_status AS ENUM (
  'queued',            -- created, not yet sent to Claude for drafting
  'claude_drafting',
  'claude_completed',
  'claude_failed',
  'validation_failed',
  'pending_approval',  -- drafted + validated, waiting on an admin
  'approved',          -- admin approved, about to send
  'sent',
  'send_failed'
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel message_channel NOT NULL,
  to_address TEXT NOT NULL,          -- phone number or email, per channel
  -- What we asked Claude to draft from (the enquiry text, job context, etc).
  context JSONB NOT NULL,
  claude_raw TEXT,                   -- Claude's full raw response, kept for debugging
  draft_text TEXT,                   -- extracted + validated message body
  status message_status NOT NULL DEFAULT 'queued',
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  provider_response JSONB,           -- raw response from MSG91/WhatsApp/email provider
  external_id TEXT,                  -- provider's message id, for delivery status lookups later
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_channel ON messages(channel);
