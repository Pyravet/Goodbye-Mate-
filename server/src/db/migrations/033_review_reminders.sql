-- Follow-up reminder asking the client to leave feedback.
--
-- Most clients never return to the journey page after the visit, so
-- reviews are only ever left by the few who happen to reopen the link.
-- A gentle nudge a couple of days later is the difference between a
-- handful of reviews and a representative picture.
--
-- Timing is deliberately admin-controlled rather than fixed. Too soon is
-- intrusive while someone is still raw; too late and they've moved on.
-- That judgement belongs to the person running the business, not to a
-- constant in the code.
ALTER TABLE jobs ADD COLUMN review_reminder_sent_at TIMESTAMPTZ;

-- Partial index: the worker only asks for completed jobs still awaiting
-- a reminder, which stays a small slice of the table.
CREATE INDEX idx_jobs_pending_review_reminder
  ON jobs (procedure_done_at)
  WHERE review_reminder_sent_at IS NULL;

UPDATE pricing_settings
SET config = jsonb_set(
      jsonb_set(
        config,
        '{reviewReminderDays}',
        COALESCE(config->'reviewReminderDays', '2'::jsonb),
        true
      ),
      '{reviewRemindersEnabled}',
      COALESCE(config->'reviewRemindersEnabled', 'true'::jsonb),
      true
    )
WHERE id = true;
