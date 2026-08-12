-- 002_vets_and_territory.sql
-- Phase 2 kickoff: vets table + real geographic territory storage.
-- Territory is stored as a PostGIS polygon (not just a postcode list),
-- so dispatch can do accurate point-in-polygon matching against a job's
-- address coordinates.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE vets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  -- Operational details — bank/ABN/GST fields are encrypted at the
  -- application layer before insert; kept as TEXT here (ciphertext),
  -- not because they're stored as plaintext.
  abn TEXT,
  is_gst_registered BOOLEAN NOT NULL DEFAULT false,
  bank_account_name_enc TEXT,
  bank_bsb_enc TEXT,
  bank_account_number_enc TEXT,
  -- Territory: a single polygon per vet for now (matches "one territory
  -- wall" from the brief). Multi-polygon support is a straightforward
  -- upgrade later if a vet ever needs disconnected coverage areas.
  territory GEOGRAPHY(POLYGON, 4326),
  territory_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spatial index so "which vets cover this job's coordinates" is fast
-- even with many vets.
CREATE INDEX idx_vets_territory ON vets USING GIST (territory);
