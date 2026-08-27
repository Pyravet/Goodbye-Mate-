-- Per-invoice GST treatment.
--
-- GST on partner invoices was gated on pricing_settings.isGstRegistered
-- — a CLIENT pricing flag that defaults to false. So no partner invoice
-- ever showed GST, regardless of the business's actual registration.
--
-- Coupling the two was wrong on its own terms: whether a B2B invoice
-- carries GST is a per-invoice decision. Some partners are billed
-- inclusive, an overseas or GST-free recipient carries none at all, and
-- the right treatment can differ between two invoices issued the same
-- day.
CREATE TYPE invoice_gst_mode AS ENUM ('inclusive', 'exclusive', 'none');

-- 'inclusive'  — amounts entered are what the partner pays; GST is the
--                eleventh already inside and is disclosed separately.
-- 'exclusive'  — amounts are ex-GST; GST is added on top.
-- 'none'       — no GST at all. NOT the same as zero: an invoice with a
--                "$0.00 GST" line implies a registration that may not
--                exist, on a document the partner files with their own
--                accounts.
ALTER TABLE partner_invoices
  ADD COLUMN gst_mode invoice_gst_mode NOT NULL DEFAULT 'inclusive';

-- The rate is stored per invoice too, and frozen on send with everything
-- else. If the rate ever changes, an already-issued document must keep
-- the rate it was issued under.
ALTER TABLE partner_invoices
  ADD COLUMN gst_percent NUMERIC(5,2) NOT NULL DEFAULT 10;
