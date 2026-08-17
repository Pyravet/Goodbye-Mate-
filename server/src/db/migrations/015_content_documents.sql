-- Lets admin attach an actual PDF brochure to the private/communal
-- cremation options, shown to clients on the aftercare step of their
-- journey. Stored directly in Postgres (bytea) rather than external
-- blob storage — these are infrequent, admin-only uploads and the file
-- sizes are small (a brochure PDF, not video), so a dedicated storage
-- service would be overkill for this.
CREATE TABLE content_documents (
  kind TEXT PRIMARY KEY CHECK (kind IN ('private_cremation', 'communal_cremation')),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  data BYTEA NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL
);
