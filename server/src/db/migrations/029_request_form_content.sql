-- Editable copy for the public booking request form.
--
-- Every word on that form was hardcoded, so changing the intro, the
-- service options, or the confirmation message meant a code change and
-- a deploy. This is the most emotionally sensitive text in the whole
-- product — it's read by someone who has just decided to put their pet
-- down — and the person best placed to get the wording right is the one
-- running the business, not whoever last edited the file.
--
-- serviceOptions is an ARRAY so options can be added or reworded
-- without a migration. It's the client-facing wording only; the actual
-- service type is still confirmed by admin when converting the request,
-- so a reworded option can't silently change what gets booked.
UPDATE content_settings
SET config = jsonb_set(
      config,
      '{requestForm}',
      COALESCE(config->'requestForm', jsonb_build_object(
        'title', 'Request a visit',
        'intro', 'We''re sorry you''re facing this. Fill in as much as you can — only your name and phone number are needed, and we''ll call you to talk through the rest.',
        'contactSectionTitle', 'How can we reach you?',
        'locationSectionTitle', 'Where are you?',
        'petSectionTitle', 'About your pet',
        'serviceSectionTitle', 'What you''re after',
        'timingLabel', 'When would you like us to come?',
        'timingPlaceholder', 'e.g. tomorrow morning, or as soon as possible',
        'messageLabel', 'Anything else we should know?',
        'submitLabel', 'Send request',
        'privacyNote', 'We''ll only use these details to contact you about this request.',
        'serviceOptions', jsonb_build_array(
          'Euthanasia only',
          'Euthanasia + private cremation (ashes returned)',
          'Euthanasia + communal cremation',
          'I''m not sure yet'
        ),
        'thankYouTitle', 'Thank you',
        'thankYouBody', 'We''ve received your request and someone will call you shortly.',
        'thankYouUrgent', 'If you need to speak with someone right away, please call us directly.'
      )),
      true
    )
WHERE id = true;
