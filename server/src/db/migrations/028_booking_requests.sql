-- Public booking requests.
--
-- Deliberately a SEPARATE table rather than creating jobs directly.
-- A public form that wrote straight into `jobs` would let anyone on the
-- internet trigger dispatch, push-notify vets at 3am, and pollute the
-- board with junk. Requests land here, admin reviews them, and only then
-- does a real job exist.
--
-- Nothing here is trusted: every field is client-supplied until admin
-- confirms it.

CREATE TYPE booking_request_status AS ENUM ('new', 'contacted', 'converted', 'declined', 'spam');

CREATE TABLE booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Client
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  client_email TEXT,

  -- Where
  address TEXT,
  suburb TEXT,
  postcode TEXT,
  state TEXT,

  -- Pet
  pet_name TEXT,
  pet_type TEXT,
  pet_breed TEXT,
  pet_weight TEXT,
  pet_age TEXT,

  -- What and when. Free text on purpose: a distressed owner shouldn't be
  -- forced through a rigid picker, and admin confirms the real slot on
  -- the phone anyway.
  service_preference TEXT,
  preferred_timing TEXT,
  message TEXT,

  status booking_request_status NOT NULL DEFAULT 'new',

  -- Set once admin turns this into a real booking, so a request can't be
  -- converted twice and the two records stay linked.
  converted_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,

  handled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ,
  admin_notes TEXT,

  -- Kept for abuse investigation only. Not shown in the UI.
  submitted_ip TEXT,
  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The admin queue reads "new first, then newest" on every load.
CREATE INDEX idx_booking_requests_status ON booking_requests(status, created_at DESC);
