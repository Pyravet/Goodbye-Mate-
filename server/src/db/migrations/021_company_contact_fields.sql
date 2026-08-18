-- Company contact details for document headers/footers.
--
-- The company settings blob already had name, abn, address and logoUrl,
-- but no phone or email — so branded invoices and RCTIs had no way to
-- tell a client or a vet how to actually reach the business. Added as
-- empty strings so admin can fill them in from Settings > Content.
UPDATE content_settings
SET config = jsonb_set(
      jsonb_set(
        config,
        '{company,phone}',
        COALESCE(config->'company'->'phone', '""'::jsonb),
        true
      ),
      '{company,email}',
      COALESCE(config->'company'->'email', '""'::jsonb),
      true
    )
WHERE id = true;
