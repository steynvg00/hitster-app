-- ─── Recap state for post-game reveal sequence ───────────────────────────────

ALTER TABLE game_sets
  ADD COLUMN IF NOT EXISTS recap_state text NOT NULL DEFAULT 'pending'
  CHECK (recap_state IN ('pending', 'revealing', 'complete'));
