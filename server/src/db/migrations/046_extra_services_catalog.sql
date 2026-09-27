-- A saved catalog of optional add-on services, each with a price.
--
-- job_line_items already lets admin add a one-off charge to a single
-- job, but every one had to be typed from scratch — label, amount and
-- vet payout re-entered by hand each time. For a service the business
-- offers repeatedly (a home-visit fee, a paw-print keepsake, a
-- certificate), that's the same three numbers retyped, with room for a
-- typo to quietly undercharge or underpay every time.
--
-- This is a TEMPLATE table. Applying one to a job still creates an
-- ordinary job_line_items row — the two are deliberately the same
-- shape, so nothing about how a job is billed or a vet is paid changes;
-- admin just gets to pick from a list instead of retyping it.
CREATE TABLE extra_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  -- What the client is charged when this is added to a job.
  client_price NUMERIC(10,2) NOT NULL CHECK (client_price >= 0),
  -- What the vet is paid for it, if anything. Zero is valid and common —
  -- an office-only add-on (e.g. a keepsake made after the visit) may
  -- pass nothing to the vet at all.
  vet_payout NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (vet_payout >= 0),
  -- Retired rather than deleted: a service used on past jobs must keep
  -- appearing on their historical invoices even after the business
  -- stops offering it. Hidden from the picker when creating a NEW
  -- charge; unaffected on jobs that already have it.
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_extra_services_active ON extra_services (is_active, sort_order);
