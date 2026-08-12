-- 005_vets_profile.sql
-- Fields from the prototype's vet object not yet on the vets table:
-- registration, postcode-list territories (kept alongside the polygon
-- territory from migration 002 — postcode list is the fast/simple
-- match, polygon is the accurate one; dispatch prefers the polygon when
-- present), weekly hour-by-hour availability, one-off date overrides,
-- and a display color for the calendar.

ALTER TABLE vets
  ADD COLUMN reg_number TEXT,
  ADD COLUMN reg_state TEXT,
  ADD COLUMN postcodes TEXT[] NOT NULL DEFAULT '{}',
  -- weekly_hours shape: { "mon": { "8": true, "9": true, ... }, "tue": {...}, ... }
  ADD COLUMN weekly_hours JSONB NOT NULL DEFAULT '{}',
  -- date_overrides shape: { "2026-08-15": false, "2026-08-16": true }
  ADD COLUMN date_overrides JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN color TEXT NOT NULL DEFAULT '#4A6B5A';

CREATE TABLE vet_note_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vet_id UUID NOT NULL REFERENCES vets(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vet_note_templates_vet_id ON vet_note_templates(vet_id);
