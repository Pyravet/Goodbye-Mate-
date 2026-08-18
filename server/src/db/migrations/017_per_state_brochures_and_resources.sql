-- Per-state cremation brochures.
--
-- content_documents previously had kind as the PRIMARY KEY, so only ONE
-- brochure could exist per cremation type nationwide. Crematorium
-- partners, pricing and paperwork differ by state, so brochures are now
-- keyed on (kind, state).
--
-- Existing rows are migrated to state = 'ALL', which acts as the
-- fallback used whenever no brochure exists for the job's own state —
-- so nothing already uploaded is lost or stops being served.

ALTER TABLE content_documents ADD COLUMN state TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE content_documents DROP CONSTRAINT content_documents_pkey;
ALTER TABLE content_documents ADD PRIMARY KEY (kind, state);

-- Supporting documents and grief resources shown to the client on their
-- journey page. Unlike brochures these aren't tied to a cremation type:
-- they're a free-form list admin can add to (a PDF, or just a link out
-- to a counselling service), shown to every client.
CREATE TABLE client_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  -- Either an uploaded PDF (data present) or an external link (url
  -- present). Exactly one of the two is required.
  filename TEXT,
  mime_type TEXT,
  data BYTEA,
  url TEXT,
  -- Optional state targeting; NULL means show to every client.
  state TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT client_resources_has_content CHECK (data IS NOT NULL OR url IS NOT NULL)
);

CREATE INDEX idx_client_resources_active ON client_resources(is_active, sort_order);
