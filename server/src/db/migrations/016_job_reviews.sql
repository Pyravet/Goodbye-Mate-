-- Post-visit star rating from the client journey page. One per job.
-- A 5-star rating also sends the client to the public Google review
-- link client-side; this table is Goodbye Mate's own internal record
-- regardless of the rating given, so low ratings aren't lost/hidden —
-- they're exactly the ones admin most wants to see.
CREATE TABLE job_reviews (
  job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
