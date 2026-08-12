-- 006_jobs.sql
-- The core table. Ported field-for-field from the prototype's job
-- object, so behavior matches what was already validated.

CREATE TYPE job_service_type AS ENUM ('euthanasia_only', 'private_cremation', 'communal_cremation');
CREATE TYPE job_time_category AS ENUM ('weekday', 'afterhours_weekend');
CREATE TYPE job_status AS ENUM ('available', 'assigned', 'in_route', 'started', 'completed', 'cancelled');
CREATE TYPE job_payment_status AS ENUM ('pending', 'paid', 'refunded');
CREATE TYPE dispatch_state AS ENUM ('none', 'offered', 'accepted', 'unassigned');

-- Generates GM-0001, GM-0002, ... — a real sequence rather than
-- counting rows, so numbers never collide or get reused even if a job
-- row is later deleted.
CREATE SEQUENCE job_number_seq START 1;

CREATE OR REPLACE FUNCTION next_job_number() RETURNS TEXT AS $$
  SELECT 'GM-' || LPAD(nextval('job_number_seq')::TEXT, 4, '0');
$$ LANGUAGE SQL;

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number TEXT NOT NULL UNIQUE DEFAULT next_job_number(),

  -- Client & pet
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  client_email TEXT,
  address TEXT NOT NULL,
  suburb TEXT,
  postcode TEXT NOT NULL,
  state TEXT NOT NULL,
  lat DOUBLE PRECISION,  -- from real Google Places autocomplete; nullable for manually-entered addresses
  lng DOUBLE PRECISION,
  pet_name TEXT NOT NULL,
  pet_type TEXT NOT NULL,
  pet_breed TEXT,
  pet_weight TEXT,
  pet_age TEXT,
  pet_behaviour TEXT NOT NULL DEFAULT 'Friendly', -- "can be snappy" flag from the brief — shown everywhere the job appears

  -- Service & schedule
  service_id TEXT NOT NULL DEFAULT 'svc_euth',
  service_type job_service_type NOT NULL,
  job_date DATE NOT NULL,
  job_time TIME NOT NULL,
  time_category job_time_category NOT NULL,

  -- Status & assignment
  status job_status NOT NULL DEFAULT 'available',
  assigned_vet_id UUID REFERENCES vets(id) ON DELETE SET NULL,

  -- Dispatch (auto-offer/rollover state machine)
  dispatch_state dispatch_state NOT NULL DEFAULT 'none',
  dispatch_offered_vet_id UUID REFERENCES vets(id) ON DELETE SET NULL,
  dispatch_expires_at TIMESTAMPTZ,
  dispatch_declined_vet_ids UUID[] NOT NULL DEFAULT '{}',

  -- Money
  extra_travel_fee NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Task gates (all required before a job can be marked complete)
  consent_signed BOOLEAN NOT NULL DEFAULT false,
  payment_status job_payment_status NOT NULL DEFAULT 'pending',
  procedure_done BOOLEAN NOT NULL DEFAULT false,
  procedure_done_at TIMESTAMPTZ,
  cremation_booked BOOLEAN NOT NULL DEFAULT false,
  cremation_booking_ref TEXT,
  ashes_returned BOOLEAN NOT NULL DEFAULT false, -- post-completion toggle, private cremation only

  -- Notes
  notes TEXT,                          -- admin/dispatch notes (e.g. "side gate is open")
  medical_notes TEXT,                  -- vet's private medical notes, never auto-shown to client
  medical_notes_sent_to TEXT[] NOT NULL DEFAULT '{}',

  reminders_sent JSONB NOT NULL DEFAULT '{}', -- { "dayOf": true, "consentPayment": false }

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_date ON jobs(job_date);
CREATE INDEX idx_jobs_assigned_vet ON jobs(assigned_vet_id);
CREATE INDEX idx_jobs_dispatch_state ON jobs(dispatch_state) WHERE dispatch_state = 'offered';

-- Per-job internal thread between admin and the assigned vet — separate
-- from client-facing messages (the `messages` table from migration 003).
CREATE TABLE job_internal_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_internal_messages_job_id ON job_internal_messages(job_id);
