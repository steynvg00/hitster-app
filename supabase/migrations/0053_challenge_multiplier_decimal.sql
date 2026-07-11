-- 0053_challenge_multiplier_decimal.sql
-- Round multiplier (set_challenges.challenge_multiplier) becomes a decimal in the
-- range 1–2.5, picked in 0.5 steps in the admin UI.
--
-- Was: integer, DEFAULT 1, CHECK (challenge_multiplier >= 1) — see 0026_bonus_mechanics.sql.
-- Now: numeric(2,1), DEFAULT 1, CHECK (challenge_multiplier BETWEEN 1 AND 2.5).
-- The DB enforces the range only; the admin picker enforces the 0.5 step.
--
-- Order matters: clamp any existing value > 2.5 down to 2.5 BEFORE adding the range
-- check (the mechanics set has a 3× challenge — the new CHECK would otherwise reject it).
--
-- Run manually in Supabase SQL Editor.

-- 1) Drop the old lower-bound-only CHECK if present (name from 0026).
DO $$ BEGIN
  ALTER TABLE set_challenges DROP CONSTRAINT set_challenges_multiplier_positive;
EXCEPTION WHEN others THEN null; END $$;

-- 2) Widen the column type to numeric(2,1), preserving existing values.
ALTER TABLE set_challenges
  ALTER COLUMN challenge_multiplier TYPE numeric(2, 1)
    USING challenge_multiplier::numeric;

-- Keep the default at 1 under the new type.
ALTER TABLE set_challenges
  ALTER COLUMN challenge_multiplier SET DEFAULT 1;

-- 3) Clamp any pre-existing value above the new ceiling BEFORE the range check.
UPDATE set_challenges
  SET challenge_multiplier = 2.5
  WHERE challenge_multiplier > 2.5;

-- 4) Add the 1–2.5 range check.
DO $$ BEGIN
  ALTER TABLE set_challenges
    ADD CONSTRAINT set_challenges_multiplier_range
      CHECK (challenge_multiplier >= 1 AND challenge_multiplier <= 2.5);
EXCEPTION WHEN duplicate_object THEN null; END $$;
