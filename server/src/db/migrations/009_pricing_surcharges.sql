-- 009_pricing_surcharges.sql
-- Adds two new surcharge fields to the existing pricing_settings config.
-- Uses jsonb merge (||) so it only adds these keys — doesn't touch any
-- pricing an admin has already customised.

UPDATE pricing_settings
SET config = config || '{
  "publicHolidaySurcharge": 129,
  "midnightFeeSurcharge": 149
}'::jsonb
WHERE id = true;
