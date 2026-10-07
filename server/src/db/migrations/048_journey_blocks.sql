-- Admin-defined extra content shown on the client's token journey page.
-- job_id NULL = GLOBAL (shown to every client); job_id set = shown only on
-- that one job's link. Files live in a child table (photos / PDFs).
CREATE TABLE journey_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  -- YouTube / Vimeo / direct mp4|webm link. Embedded, never uploaded:
  -- video bytes in Postgres would be slow and costly.
  video_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_journey_blocks_job ON journey_blocks(job_id, is_active, sort_order);

CREATE TABLE journey_block_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id UUID NOT NULL REFERENCES journey_blocks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_journey_block_files_block ON journey_block_files(block_id);
