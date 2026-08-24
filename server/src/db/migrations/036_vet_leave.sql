-- Vet leave.
--
-- Availability exists as weekly_hours plus per-DAY date_overrides, so
-- booking a fortnight off meant ticking fourteen individual days — which
-- nobody does. The result: dispatch kept offering jobs the vet couldn't
-- take, and every one they let lapse counted against their reliability
-- stats. They were being penalised for the system not knowing.
--
-- A date RANGE is the shape people actually think in ("I'm away the
-- 14th to the 28th"), and it's one record rather than fourteen.
CREATE TABLE vet_leave (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vet_id UUID NOT NULL REFERENCES vets(id) ON DELETE CASCADE,

  -- Inclusive local dates, matching how leave is spoken about: "away
  -- the 14th to the 28th" includes both days.
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,

  reason TEXT,

  -- Who entered it. A vet books their own leave; admin can also record
  -- it after a phone call, and the two are worth telling apart.
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT vet_leave_dates_ordered CHECK (ends_on >= starts_on)
);

-- The dispatch check asks "is this vet on leave on this date" for every
-- candidate on every offer, so it needs to be cheap.
CREATE INDEX idx_vet_leave_lookup ON vet_leave (vet_id, starts_on, ends_on);
