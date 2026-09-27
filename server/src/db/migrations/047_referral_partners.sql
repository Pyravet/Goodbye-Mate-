-- Clinics -> third-party referral partners.
--
-- The clinic portal (migration 040) was scoped to veterinary clinics
-- specifically, with commission deliberately left unbuilt pending a
-- regulatory answer for fee-splitting on patient referrals. That answer
-- is now: treat every referring entity the same, no restriction. This
-- widens the concept to ANY business that refers clients on a
-- commission basis — a funeral home, a pet store, a clinic, or anything
-- else — and adds the payout machinery that was held back before.
--
-- This is a CLEAN REBUILD, not a compatible migration: the clinic
-- portal has no live users yet, so there is no data to preserve and no
-- login to keep working through the change. Old tables are dropped and
-- recreated under their new names rather than carrying clinic-specific
-- naming forward for a concept that no longer means just clinics.

DROP INDEX IF EXISTS idx_jobs_clinic;
DROP INDEX IF EXISTS idx_booking_requests_clinic;
ALTER TABLE jobs DROP COLUMN IF EXISTS referred_by_clinic_id;
ALTER TABLE booking_requests DROP COLUMN IF EXISTS referred_by_clinic_id;
DROP TABLE IF EXISTS clinic_users;
DROP TABLE IF EXISTS clinics;

-- 'clinic' role -> 'referral_partner'. Same reasoning as migration 040
-- for why this is TEXT + CHECK rather than an enum: ALTER TYPE ... ADD
-- VALUE cannot run inside the transaction this runner wraps every
-- migration in.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'vet', 'referral_partner'));

CREATE TABLE referral_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name TEXT NOT NULL,
  -- What kind of business this is. TEXT + CHECK, not an enum, for the
  -- same reason as the role above: a new type is then a one-line change
  -- rather than a migration that can't run inside a transaction.
  type TEXT NOT NULL DEFAULT 'other'
    CHECK (type IN ('clinic', 'funeral_home', 'pet_store', 'other')),

  phone TEXT,
  email TEXT,
  address TEXT,
  suburb TEXT,
  postcode TEXT,
  state TEXT,
  abn TEXT,
  is_gst_registered BOOLEAN NOT NULL DEFAULT false,

  -- Commission: admin picks flat dollars or a percentage, per partner.
  -- Two different partners can be paid completely differently — one a
  -- flat $30 a referral, another 8% of the job.
  commission_type TEXT NOT NULL DEFAULT 'flat' CHECK (commission_type IN ('flat', 'percentage')),
  -- Dollars when commission_type = 'flat'; a number like 8 (meaning 8%)
  -- when 'percentage'. One column rather than two nullable ones, since
  -- commission_type already says which interpretation applies and a
  -- partner never has both at once.
  commission_value NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (commission_value >= 0),

  -- Same three encrypted columns as vets, same encryption module
  -- (server/src/security/encryption.js), same masking rules on display.
  -- Payout details for a business being paid real money get the same
  -- security bar regardless of which side of the referral they're on.
  bank_account_name_enc TEXT,
  bank_bsb_enc TEXT,
  bank_account_number_enc TEXT,

  -- Deactivated rather than deleted. A partner that stops referring
  -- still has historical jobs and paid commission statements attributed
  -- to it, and those records must not lose the attribution that
  -- explains where the money came from or went.
  is_active BOOLEAN NOT NULL DEFAULT true,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One partner can have several logins.
CREATE TABLE referral_partner_users (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referral_partner_id UUID NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_referral_partner_users_partner ON referral_partner_users (referral_partner_id);

-- Attribution, same lifecycle as before: recorded on the REQUEST when
-- submitted, carried onto the JOB when converted, so it survives even
-- if the request is later tidied away.
ALTER TABLE booking_requests ADD COLUMN referred_by_partner_id UUID REFERENCES referral_partners(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN referred_by_partner_id UUID REFERENCES referral_partners(id) ON DELETE SET NULL;

CREATE INDEX idx_booking_requests_partner ON booking_requests (referred_by_partner_id, created_at DESC);
CREATE INDEX idx_jobs_partner ON jobs (referred_by_partner_id) WHERE referred_by_partner_id IS NOT NULL;

-- Commission becomes owed the moment a referred job is marked
-- COMPLETED — not on booking, not on payment. A cancelled referred job
-- owes nothing; that's simply never being in this set, the same way an
-- incomplete vet job never appears in a vet payout period. Nothing
-- extra needs writing when a job completes: eligibility is read
-- straight off jobs.status at approval time, exactly like the vet
-- payout period query does.

CREATE TYPE referral_payout_status AS ENUM ('draft', 'approved', 'paid');

CREATE TABLE referral_partner_payout_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_partner_id UUID NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,

  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  status referral_payout_status NOT NULL DEFAULT 'draft',

  -- A commission statement, not an RCTI. RCTI (recipient-created tax
  -- invoice) is a specific ATO construct tied to GST and a registered
  -- supplier relationship with a vet performing a taxable supply; a
  -- referral partner receiving a commission is a different legal
  -- relationship, and labelling this an RCTI would misdescribe it.
  statement_number TEXT UNIQUE,

  -- Frozen at approval, same reasoning as vet payouts: pricing and
  -- commission rates can change after the fact, and an issued statement
  -- must not silently change with them.
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  gst NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,

  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (referral_partner_id, period_start)
);

CREATE INDEX idx_referral_payout_periods_partner ON referral_partner_payout_periods(referral_partner_id, period_start DESC);
CREATE INDEX idx_referral_payout_periods_status ON referral_partner_payout_periods(status, period_start DESC);

-- Frozen line detail behind a period's total: one row per referred job,
-- with the commission as computed at approval time.
CREATE TABLE referral_partner_payout_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES referral_partner_payout_periods(id) ON DELETE CASCADE,

  -- SET NULL rather than CASCADE: deleting a job must not silently
  -- alter the total of an already-issued statement.
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,

  -- Denormalised deliberately, so the statement can still be reproduced
  -- exactly even if the job is later edited or removed.
  job_number TEXT NOT NULL,
  job_date DATE NOT NULL,
  client_name TEXT,
  -- What the commission was CALCULATED FROM, frozen alongside the
  -- result — so a partner querying "why $36?" can be shown "8% of
  -- $450", not just the final number with no working.
  job_total NUMERIC(10,2) NOT NULL,
  commission_type TEXT NOT NULL,
  commission_value NUMERIC(10,2) NOT NULL,
  amount NUMERIC(10,2) NOT NULL
);

CREATE INDEX idx_referral_payout_items_period ON referral_partner_payout_items(period_id);

-- Dedicated sequence table, same pattern as rcti_sequence: a row lock
-- at allocation time is what stops two concurrent approvals landing on
-- the same statement number.
CREATE TABLE referral_statement_sequence (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  next_number INT NOT NULL DEFAULT 1,
  prefix TEXT NOT NULL DEFAULT 'COMM-'
);
INSERT INTO referral_statement_sequence (id) VALUES (true);
