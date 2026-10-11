-- More than one cremation brochure per state.
--
-- Several cremation providers can operate in the same state, and the
-- family should see each provider's brochure. content_documents was keyed
-- (kind, state) so a second upload silently REPLACED the first. It now has
-- its own id, an optional label (the provider's name), and any number of
-- rows per (kind, state).
--
-- Existing rows keep working: ADD COLUMN with a volatile default fills
-- each existing row with its own uuid.
ALTER TABLE content_documents ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE content_documents ADD COLUMN label TEXT;
ALTER TABLE content_documents DROP CONSTRAINT content_documents_pkey;
ALTER TABLE content_documents ADD PRIMARY KEY (id);
CREATE INDEX idx_content_documents_kind_state ON content_documents (kind, state, uploaded_at);
