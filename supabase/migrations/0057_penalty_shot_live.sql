-- 0057_penalty_shot_live.sql
--
-- Piece 4 of 4 (FINAL) of the powerup earning rebuild. Flips penalty_shot from
-- a coming_soon placeholder (migration 0056) to a live, opt-in inverse powerup:
-- earned when a team scores BELOW a threshold instead of above one. Effect is
-- purely social — "take a shot 🥃" — no score/timer/multiplier impact.
--
-- ── default_inverse (new column) ─────────────────────────────────────────────
-- The pure planner (planAwards, src/lib/server/powerups.ts) has always decided
-- "is this type inverse?" from a PER-SET config override
-- (powerup_config.types[id].inverse) — but the admin console has no control to
-- set that override; it only ever writes enabled/threshold/chance. Without a
-- default, a host enabling penalty_shot from the console would put it in the
-- NORMAL ladder pool (eligible whenever submissionPct is between 0 and its
-- default_max_score_pct AND some band has crossed) — which only fires in the
-- narrow band-crossing window, not "any score below the bound" as designed.
--
-- default_inverse is a property of the TYPE (like enabled_by_default), read as
-- a fallback when the per-set config doesn't override it:
--   resolved_inverse = cfg.types[id]?.inverse ?? type.default_inverse
-- This is the one piece of runtime logic this migration requires (see the
-- accompanying powerups.ts diff) — flipping coming_soon alone is NOT enough for
-- the earning to behave as inverse, only for the console to show its controls.
--
-- Run manually in Supabase SQL Editor.

DO $$ BEGIN
  ALTER TABLE powerup_types ADD COLUMN IF NOT EXISTS default_inverse boolean NOT NULL DEFAULT false;
EXCEPTION WHEN others THEN null; END $$;

-- Flip penalty_shot live:
--   coming_soon        false  — console shows real controls, not "Coming soon"
--   enabled_by_default false  — stays OPT-IN; a host must enable it per set
--   immediate_use      true   — fires on earn (auto-activates via allowFromPending,
--                               same machinery as bonus_points/hard_gaan/single_event_mult)
--   holdable           false  — nothing to store/hold, it's a one-shot reveal
--   default_inverse    true   — earned via the inverse channel (score BELOW the bound)
--   default_max_score_pct 40  — the inverse bound: score below 40% risks a shot.
--                               Host can override per-set via types.penalty_shot.threshold.
UPDATE powerup_types
  SET coming_soon = false,
      enabled_by_default = false,
      immediate_use = true,
      holdable = false,
      default_inverse = true,
      default_max_score_pct = 40,
      name = 'Penalty Shot',
      icon = '🥃',
      description = 'Score below the bound and your team takes a shot 🥃 — purely social, no effect on your score.'
  WHERE id = 'penalty_shot';
