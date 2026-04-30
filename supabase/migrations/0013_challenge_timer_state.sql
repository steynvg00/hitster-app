-- =============================================================================
-- Hitster — Session 7: challenge timer state
-- Adds started_at timestamp to challenges so the server can compute the
-- authoritative timer deadline (started_at + timer_seconds).
-- The client gets timerEndsAt from the load function; the admin auto-submit
-- sweep compares now() against this to find expired challenges.
-- =============================================================================

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- Partial index for the auto-submit sweep query:
-- WHERE started_at IS NOT NULL AND started_at + (timer_seconds * interval '1 second') < now()
CREATE INDEX IF NOT EXISTS challenges_started_at_idx
  ON challenges (started_at)
  WHERE started_at IS NOT NULL;
