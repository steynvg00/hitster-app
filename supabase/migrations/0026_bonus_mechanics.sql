-- 0026_bonus_mechanics.sql
-- Adds columns needed for bonus scoring mechanics:
-- difficulty rating, speed threshold, hint text on challenges;
-- per-challenge round multiplier on set_challenges;
-- scores_hidden flag on game_sets;
-- streak config on variant_defaults;
-- current_streak counter on teams.
--
-- Run manually in Supabase SQL Editor.

-- ── challenges ──────────────────────────────────────────────────────────────

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS difficulty_rating integer NOT NULL DEFAULT 3
    CONSTRAINT challenges_difficulty_rating_check CHECK (difficulty_rating BETWEEN 1 AND 5);

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS speed_threshold_seconds integer;

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS hint_text text;

-- ── set_challenges ───────────────────────────────────────────────────────────

ALTER TABLE set_challenges
  ADD COLUMN IF NOT EXISTS challenge_multiplier integer NOT NULL DEFAULT 1
    CONSTRAINT set_challenges_multiplier_positive CHECK (challenge_multiplier >= 1);

-- ── game_sets ────────────────────────────────────────────────────────────────

ALTER TABLE game_sets
  ADD COLUMN IF NOT EXISTS scores_hidden boolean NOT NULL DEFAULT false;

-- ── variant_defaults ─────────────────────────────────────────────────────────
-- streak_config shape: { "thresholds": [{ "streak": 3, "bonus": 5 }, { "streak": 5, "bonus": 10 }] }

ALTER TABLE variant_defaults
  ADD COLUMN IF NOT EXISTS streak_config jsonb;

-- ── teams ────────────────────────────────────────────────────────────────────

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS current_streak integer NOT NULL DEFAULT 0;
