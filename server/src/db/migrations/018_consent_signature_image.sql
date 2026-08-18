-- Drawn consent signature, stored as PNG bytes alongside the typed name.
-- A typed name alone is weak evidence of consent for a procedure this
-- serious; an actual drawn signature is what clients expect to give and
-- what's most defensible if a consent is ever disputed.
ALTER TABLE jobs ADD COLUMN consent_signature_image BYTEA;
