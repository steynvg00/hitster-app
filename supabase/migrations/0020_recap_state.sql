-- ─── Recap state for post-game reveal sequence ───────────────────────────────

ALTER TABLE game_sets
  ADD COLUMN IF NOT EXISTS recap_state text NOT NULL DEFAULT 'pending'
    CHECK (recap_state IN ('pending', 'revealing', 'complete')),
  -- Ordered array of team_ids from last place → first place (set on first reveal)
  ADD COLUMN IF NOT EXISTS recap_ranking jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- How many teams have been revealed (0 = none)
  ADD COLUMN IF NOT EXISTS recap_reveal_index int NOT NULL DEFAULT 0;
