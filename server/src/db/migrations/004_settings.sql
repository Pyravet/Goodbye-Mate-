-- 004_settings.sql
-- Admin-editable settings, ported directly from the prototype's
-- defaultPricing/defaultContent/defaultTemplates. Single-row tables
-- (a "singleton" pattern) since there's only ever one active config —
-- simpler than a key/value store for this shape of data, and the whole
-- object is always read/written together anyway.

CREATE TABLE pricing_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id), -- enforces exactly one row
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO pricing_settings (id, config) VALUES (true, '{
  "services": [{ "id": "svc_euth", "name": "Euthanasia", "clientPrice": 449, "vetWeekday": 340, "vetAfterhours": 460 }],
  "transferFee": { "clientPrice": 49, "vetWeekday": 20, "vetAfterhours": 20 },
  "afterHoursSurcharge": 99,
  "communalCremationFee": 190,
  "gstPercent": 10
}'::jsonb);

CREATE TABLE content_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO content_settings (id, config) VALUES (true, '{
  "consentTemplate": "By signing below, you confirm you understand and consent to the euthanasia procedure for {petName} on {date}.",
  "educationalIntro": "{vetName} will visit you at home on {date} at {time}. They will take things at your pace, answer any questions, and make sure {petName} is comfortable throughout.",
  "noCremationNote": "You have chosen no cremation. We will talk you through aftercare options during the visit if you would like to change this.",
  "privateCremationBrochure": "You have chosen private cremation. After the visit, {petName} will be taken to {crematorium}, who will contact you directly. Ashes are typically returned within two weeks.",
  "communalCremationBrochure": "You have chosen communal cremation. {petName} will be cared for respectfully by {crematorium} alongside other pets, with no ashes returned.",
  "cremationBrochures": {},
  "company": {
    "name": "Goodbye Mate",
    "abn": "",
    "address": "",
    "logoUrl": "",
    "rctiDeclaration": "This is a recipient created tax invoice (RCTI). Goodbye Mate will retain the original copy of this tax invoice and a copy will be provided to the recipient. This RCTI is only valid subject to the RCTI agreement in place between the parties. The GST shown (if any) is payable by Goodbye Mate."
  }
}'::jsonb);

CREATE TABLE message_templates (
  id TEXT PRIMARY KEY, -- e.g. 'booking_confirmed', matches the prototype's template ids
  label TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO message_templates (id, label, text) VALUES
  ('booking_confirmed', 'Booking confirmed', 'Hi {clientName}, this is Goodbye Mate. Your appointment for {petName} is confirmed for {date} at {time}.'),
  ('vet_assigned', 'Vet assigned', 'Hi {clientName}, Dr {vetName} will be visiting you and {petName} on {date} at {time}.'),
  ('vet_on_route', 'Vet on the way', 'Dr {vetName} is on the way to you now and should arrive shortly.'),
  ('running_late', 'Vet running late', 'Hi {clientName}, {vetName} is running a little behind schedule and will confirm an updated arrival time shortly.'),
  ('procedure_completed', 'Procedure completed', 'We are thinking of you. {petName} has been cared for gently and with dignity.'),
  ('cremation_update', 'Cremation update', 'Hi {clientName}, {petName} is now confirmed with our cremation partner.'),
  ('ashes_ready', 'Ashes ready', 'Hi {clientName}, {petName}''s ashes are ready and on their way back to you.'),
  ('payment_receipt', 'Payment receipt', 'Hi {clientName}, we have received your payment for {petName}''s care. Thank you.'),
  ('day_of_reminder', 'Day-of reminder', 'Hi {clientName}, just a gentle reminder that we will be visiting you and {petName} today at {time}.'),
  ('consent_payment_reminder', 'Consent/payment nudge', 'Hi {clientName}, ahead of your visit for {petName}, could you please complete your consent form and payment?'),
  ('review_request', 'Review request', 'Hi {clientName}, thank you again for trusting Goodbye Mate with {petName}. We would be grateful for a short review.');
