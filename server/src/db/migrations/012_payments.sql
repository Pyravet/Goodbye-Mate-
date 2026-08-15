-- 012_payments.sql
-- Every payment attempt gets a row, success or failure — this is the
-- audit trail for "did the client actually pay", separate from the
-- simple payment_status flag on jobs (which just reflects the latest
-- successful outcome).

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  provider TEXT NOT NULL DEFAULT 'eway',
  provider_transaction_id TEXT,
  status TEXT NOT NULL, -- 'succeeded' | 'failed'
  response_message TEXT,
  processed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_job_id ON payments(job_id);

ALTER TABLE jobs ADD COLUMN payment_reference TEXT;
