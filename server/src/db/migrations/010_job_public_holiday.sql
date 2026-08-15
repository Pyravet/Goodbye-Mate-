-- 010_job_public_holiday.sql
-- Public holidays aren't auto-detected (would need a per-state AU public
-- holiday calendar) — instead, admin flags it at booking time, same way
-- they already pick weekday/after-hours by eye when they know the date.

ALTER TABLE jobs ADD COLUMN is_public_holiday BOOLEAN NOT NULL DEFAULT false;
