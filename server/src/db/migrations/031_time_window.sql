-- Arrival time WINDOWS instead of a single fixed time.
--
-- job_time is a single TIME, so every booking promises an exact arrival
-- minute. In practice an at-home visit can't be that precise: travel,
-- and the fact that the previous visit genuinely cannot be rushed, mean
-- a fixed time either gets missed or forces the vet to hurry a family.
-- A window ("between 2pm and 4pm") is honest about that and is what the
-- client is usually told on the phone anyway.
--
-- job_time is KEPT as the window START rather than replaced, so every
-- existing query, sort, PDF and SMS keeps working untouched. A NULL
-- job_time_end simply means a fixed time, which is what all existing
-- bookings become.
ALTER TABLE jobs ADD COLUMN job_time_end TIME;

COMMENT ON COLUMN jobs.job_time IS
  'Appointment time, or the START of the arrival window when job_time_end is set.';
COMMENT ON COLUMN jobs.job_time_end IS
  'End of the arrival window. NULL means a fixed appointment time.';
