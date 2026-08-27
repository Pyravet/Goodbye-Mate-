-- Invoices issued TO other businesses.
--
-- Crematorium partners, referring clinics and corporate accounts are
-- billed by the business, and that is a different document from
-- everything already here:
--
--   client invoice — issued to a pet owner, tied to one job
--   RCTI          — issued BY the business ON BEHALF OF a vet supplier
--   partner invoice (this) — issued BY the business TO another business,
--                            with its own numbering and its own terms
--
-- Numbered from a separate sequence. Sharing the job or RCTI numbering
-- would interleave three unrelated document series, which makes both
-- reconciliation and any future audit considerably harder.
CREATE TABLE partner_invoice_sequence (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  next_number INT NOT NULL DEFAULT 1
);
INSERT INTO partner_invoice_sequence (id) VALUES (true);

CREATE TYPE partner_invoice_status AS ENUM ('draft', 'sent', 'paid', 'void');

CREATE TABLE partner_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Allocated at SEND, not at creation. A draft that is edited or
  -- abandoned must not consume a number: gaps in an invoice series are
  -- exactly what an auditor asks about.
  invoice_number TEXT UNIQUE,

  -- Who is being billed. Stored on the invoice rather than referencing a
  -- partners table: an invoice is a record of what was true when it was
  -- issued, and a partner later changing their address must not silently
  -- rewrite documents already sent.
  recipient_name TEXT NOT NULL,
  recipient_email TEXT,
  recipient_abn TEXT,
  recipient_address TEXT,

  issue_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Australia/Melbourne')::date,
  due_date DATE,

  -- Frozen at send, never recomputed. A tax document that changes after
  -- issue is not a tax document.
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  gst NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,

  status partner_invoice_status NOT NULL DEFAULT 'draft',
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  notes TEXT,

  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_partner_invoices_status ON partner_invoices (status, issue_date DESC);

CREATE TABLE partner_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES partner_invoices(id) ON DELETE CASCADE,

  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Stored rather than derived, so a rounding rule change later cannot
  -- alter the arithmetic on an invoice already issued.
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Optional link to the job the work relates to, for reconciliation.
  -- SET NULL rather than CASCADE: deleting a job must not silently
  -- remove a line from a tax invoice someone has already been sent.
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,

  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_partner_invoice_items_invoice ON partner_invoice_items (invoice_id, sort_order);

-- Bank details for payment BY bank transfer.
--
-- These are the business's OWN details, printed on every invoice for the
-- recipient to pay into — so unlike vet bank details they are not
-- secret and are deliberately NOT encrypted. Encrypting a number that is
-- printed on the document would be security theatre.
UPDATE content_settings
SET config = jsonb_set(
      config, '{bankDetails}',
      COALESCE(config->'bankDetails', jsonb_build_object(
        'accountName', '', 'bsb', '', 'accountNumber', '',
        'bankName', '', 'paymentTerms', 'Payment due within 14 days.'
      )),
      true
    )
WHERE id = true;
