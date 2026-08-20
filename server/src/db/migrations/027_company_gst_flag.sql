-- Whether the business itself is registered for GST.
--
-- pricing_settings already had gstPercent, but nothing on the CLIENT
-- invoice ever used it — client invoices showed a bare total with no GST
-- component at all, while vet RCTIs split it correctly. In Australia a
-- GST-registered supplier must show the GST amount (or a statement that
-- the total includes GST) for a document to be a valid tax invoice.
--
-- Defaults to FALSE deliberately. Claiming GST on invoices when the
-- business isn't registered is a worse error than omitting it when it
-- is: the first misrepresents a tax position to clients, the second is a
-- formatting gap. Admin turns this on explicitly once confirmed.
UPDATE pricing_settings
SET config = jsonb_set(
      config,
      '{isGstRegistered}',
      COALESCE(config->'isGstRegistered', 'false'::jsonb),
      true
    )
WHERE id = true;
