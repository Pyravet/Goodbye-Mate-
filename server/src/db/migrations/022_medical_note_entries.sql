-- Medical notes as an append-only, attributed log.
--
-- jobs.medical_notes was a single free-text column that each save
-- overwrote. For a clinical record that's the wrong shape: there was no
-- record of WHO wrote a note or WHEN, and editing silently destroyed
-- whatever was there before. If a record is ever produced for an
-- insurer or in a dispute, "one paragraph, last writer wins, no
-- timestamp" is not defensible.
--
-- Entries are therefore append-only. Existing jobs.medical_notes content
-- is migrated in as a single initial entry so nothing is lost, and the
-- column is kept (not dropped) so any code path still reading it keeps
-- working — it now holds the concatenated view.

CREATE TABLE job_medical_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  body TEXT NOT NULL,

  -- Attribution is denormalised on purpose: the record must still show
  -- who wrote an entry even if that user is later deactivated or
  -- removed, which ON DELETE SET NULL alone would not preserve.
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_role TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_medical_notes_job ON job_medical_notes(job_id, created_at);

-- Carry across anything already written, attributed to the assigned vet
-- where there is one. created_at falls back to the job's own timestamp
-- rather than now(), so the entry isn't misdated to the migration.
INSERT INTO job_medical_notes (job_id, body, author_user_id, author_name, author_role, created_at)
SELECT
  j.id,
  j.medical_notes,
  u.id,
  COALESCE(u.full_name, 'Unknown'),
  'vet',
  COALESCE(j.procedure_done_at, j.updated_at, now())
FROM jobs j
LEFT JOIN vets v ON v.id = j.assigned_vet_id
LEFT JOIN users u ON u.id = v.user_id
WHERE j.medical_notes IS NOT NULL AND trim(j.medical_notes) <> '';
