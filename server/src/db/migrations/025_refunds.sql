-- Refunds.
--
-- job_payment_status has always had a 'refunded' value, but nothing ever
-- set it and there was no way to record that money went back — so a
-- refunded job still showed as paid, and the payout run would still pay
-- the vet for it as though the client had been charged.
--
-- Refunds are recorded as rows in `payments` (status 'refunded') rather
-- than by mutating the original charge row, so the ledger stays
-- append-only and the original transaction remains visible. A partial
-- refund is therefore just a refund row for less than the charge.

ALTER TABLE jobs ADD COLUMN refunded_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN refunded_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN refund_reason TEXT;

-- Links a refund row back to the charge it reverses, so a job with
-- several transactions can still be reconciled.
ALTER TABLE payments ADD COLUMN refunds_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;

-- Distinguishes a refund processed through eWay from one recorded by
-- admin after refunding by other means (bank transfer, cash). Without
-- this, the books can't show whether the gateway actually moved money.
ALTER TABLE payments ADD COLUMN is_manual BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_payments_refunds ON payments(refunds_payment_id) WHERE refunds_payment_id IS NOT NULL;
