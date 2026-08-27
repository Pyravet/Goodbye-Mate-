-- Vet clinic partners.
--
-- Clinics refer clients to the service. This gives them somewhere to
-- submit a referral and see what happened to it, which is useful to them
-- on its own — today a clinic hands over a phone number and never learns
-- whether the family was looked after.
--
-- DELIBERATELY NO COMMISSION YET. Fee-splitting for patient referrals is
-- restricted in parts of Australian veterinary regulation, and the right
-- commercial model (referral fee vs trade rate) is still undecided.
-- Building the portal first tests whether clinics use it at all, and
-- attribution is recorded from day one so a payment model can be added
-- later against real data rather than guesses.

-- NOT done with ALTER TYPE ... ADD VALUE: that cannot run inside a
-- transaction block, and this runner wraps every migration in one, so it
-- would fail the whole deploy. Converting to TEXT with a CHECK gives the
-- same guarantee and makes the next role a one-line change. Same pattern
-- as migration 030.
ALTER TABLE users ALTER COLUMN role TYPE TEXT;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'vet';
ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'vet', 'clinic'));

CREATE TABLE clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name TEXT NOT NULL,
  -- Contact details for the CLINIC, distinct from the login user: a
  -- practice manager may hold the account while enquiries go to reception.
  phone TEXT,
  email TEXT,
  address TEXT,
  suburb TEXT,
  postcode TEXT,
  state TEXT,
  abn TEXT,

  -- Deactivated rather than deleted. A clinic that leaves still has
  -- referrals attributed to it, and those job records must not lose the
  -- attribution that explains where they came from.
  is_active BOOLEAN NOT NULL DEFAULT true,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One clinic can have several logins — a practice manager and a head
-- nurse both submitting referrals is normal.
CREATE TABLE clinic_users (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clinic_users_clinic ON clinic_users (clinic_id);

-- Attribution. Recorded on the REQUEST when submitted and carried onto
-- the JOB when converted, so the link survives even if the request is
-- later tidied away.
ALTER TABLE booking_requests ADD COLUMN referred_by_clinic_id UUID REFERENCES clinics(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN referred_by_clinic_id UUID REFERENCES clinics(id) ON DELETE SET NULL;

-- The clinic's own dashboard asks "my referrals" on every load.
CREATE INDEX idx_booking_requests_clinic ON booking_requests (referred_by_clinic_id, created_at DESC);
CREATE INDEX idx_jobs_clinic ON jobs (referred_by_clinic_id) WHERE referred_by_clinic_id IS NOT NULL;
