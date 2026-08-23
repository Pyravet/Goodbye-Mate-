-- Appointment reminders for vets.
--
-- A vet accepts a job days ahead and then has nothing until they happen
-- to open the app. A reminder shortly before the visit is the difference
-- between arriving prepared and arriving late — or not at all.
--
-- reminder_sent_at is on the JOB rather than a separate log because the
-- only question that matters is "has this job been reminded about", and
-- it doubles as the idempotency guard: the worker ticks every minute, so
-- without it a vet would be notified repeatedly for the same visit.
ALTER TABLE jobs ADD COLUMN reminder_sent_at TIMESTAMPTZ;

-- Partial index: the worker only ever asks for upcoming jobs that
-- haven't been reminded yet, which is a small slice of the table.
CREATE INDEX idx_jobs_pending_reminder
  ON jobs (job_date, job_time)
  WHERE reminder_sent_at IS NULL;

-- Admin-configurable, because the right lead time is an operational
-- decision, not a constant. Two hours is the default asked for; a vet
-- covering a wide rural territory may want longer.
UPDATE pricing_settings
SET config = jsonb_set(
      jsonb_set(
        config,
        '{reminderHoursBefore}',
        COALESCE(config->'reminderHoursBefore', '2'::jsonb),
        true
      ),
      '{remindersEnabled}',
      COALESCE(config->'remindersEnabled', 'true'::jsonb),
      true
    )
WHERE id = true;
