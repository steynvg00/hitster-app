-- 0072_power_spin_and_tiers.sql
--
-- Two things, one migration, because neither is useful without the other:
--   1. A TIER classification on every powerup type (new column).
--   2. power_spin — the first powerup that AWARDS ANOTHER POWERUP, which is the
--      only reason the tier column has to exist at all.
--
-- ── Why `tier` is a COLUMN and not a powerup_config key ─────────────────────
-- The codebase draws a hard line between the two storage locations:
--
--   powerup_types.<column>        a fixed trait OF THE TYPE
--                                 (category, holdable, immediate_use,
--                                  default_inverse — added the same way by
--                                  0057_penalty_shot_live.sql)
--   powerup_config.types[id].<k>  a PER-SET setting a host can retune
--                                 (chance, threshold, dice_min/dice_max via
--                                  resolveDiceRange, reveal_budget via
--                                  resolveXrayBudget)
--
-- A tier is what a powerup IS — its power band — not a dial a host turns per
-- set. Free Tab is not stronger in one game than another. So it sits on the type
-- row, alongside `category`, and is read the same way.
--
-- The A/S SPLIT does go into powerup_config (section 4 below): how often the
-- wheel reaches for the top shelf is exactly the kind of per-set tuning
-- dice_min/dice_max and reveal_budget already live in.
--
-- ── This column does NOT change earning ─────────────────────────────────────
-- planAwards (src/lib/server/powerups.ts) builds its pool from coming_soon,
-- enabled, category and the min/max score bounds. It does not read `tier` and is
-- not touched by this migration. The column is additive data that power_spin
-- reads — and that a later balance pass may read — with zero effect on which
-- powerups a team earns from a submission today.
--
-- ── Tier assignment ─────────────────────────────────────────────────────────
--   S  resurrection, all_seeing_eye     NOT YET BUILT — no row exists, so
--                                       nothing is set for them here. Each gets
--                                       its tier in its own build migration.
--                                       NOTE: this leaves Tier S EMPTY today,
--                                       which the roll handles by design (§4).
--   A  free_tab, double_down, freeze, time_drain, power_spin
--   B  x_ray, lifeline, insurance, shield, time_boost
--   C  free_answer, lucky_dice, bonus_points, hard_gaan, give_a_shot,
--      tap_to_break, single_event_mult
--   D  penalty_shot
--
-- That is all 17 existing rows, each named exactly once.
--
-- Idempotent throughout: ADD COLUMN IF NOT EXISTS, UPDATEs that restate the same
-- value, an INSERT ... ON CONFLICT DO NOTHING, and a config seed that only
-- touches sets which have no tier_s_chance yet. Safe to re-run.
--
-- Run manually in Supabase SQL Editor.

-- ── 1. The tier column ──────────────────────────────────────────────────────
-- DEFAULT 'C' rather than NULL so the column is NOT NULL from the first moment
-- and no reader ever has to handle an absent tier. 'C' is the middle of the
-- range: a future type whose author forgets to set a tier lands somewhere
-- unremarkable instead of accidentally in the Power Spin pool.
DO $$ BEGIN
  ALTER TABLE powerup_types
    ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'C';
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE powerup_types
    ADD CONSTRAINT powerup_types_tier_check CHECK (tier IN ('S', 'A', 'B', 'C', 'D'));
EXCEPTION WHEN others THEN null; END $$;

-- ── 2. Tiers for the existing catalog ───────────────────────────────────────
UPDATE powerup_types SET tier = 'A'
  WHERE id IN ('free_tab', 'double_down', 'freeze', 'time_drain', 'power_spin');

UPDATE powerup_types SET tier = 'B'
  WHERE id IN ('x_ray', 'lifeline', 'insurance', 'shield', 'time_boost');

UPDATE powerup_types SET tier = 'C'
  WHERE id IN ('free_answer', 'lucky_dice', 'bonus_points', 'hard_gaan',
               'give_a_shot', 'tap_to_break', 'single_event_mult');

UPDATE powerup_types SET tier = 'D'
  WHERE id IN ('penalty_shot');

-- ── 3. power_spin ───────────────────────────────────────────────────────────
-- The mechanic (implemented in src/lib/server/powerups.ts, 'power_spin' branch,
-- recorded here):
--
--   Rolls ONE powerup out of the Tier A/S pool and awards it to the spinning
--   team. Weighted: mostly A, rarely S (§4). The rolled powerup then follows ITS
--   OWN nature — immediate-use fires at once, holdable goes to the stock, a type
--   with a choice offers that choice — because power_spin does NOT handle the
--   outcome itself. It rolls a type and hands it to materializeAward(), the very
--   function the earning ladder uses, so the result is indistinguishable from a
--   powerup the team earned by scoring.
--
--   immediate_use = true / holdable = false: there is nothing to store. The spin
--   IS the powerup; what it produces is what gets stored. So it auto-activates on
--   earn via the allowFromPending path, the same as bonus_points and lucky_dice.
--
--   category 'self': it acts on the spinning team only, no target picker.
--
--   Recursion: power_spin is Tier A, so it could roll ITSELF and loop. The roll
--   pool therefore subtracts SPIN_EXCLUDED_TYPE_IDS (src/lib/powerups-meta.ts) —
--   power_spin plus any future type that also awards powerups. No existing type
--   awards a powerup (verified branch by branch: give_a_shot, penalty_shot,
--   freeze, time_drain and tap_to_break all write team_effects rows, never
--   team_powerups), so the chain is at most
--   materializeAward -> activatePowerup(power_spin) -> materializeAward ->
--   activatePowerup(rolled) and terminates there.
--
--   Earn bound 80%: a Tier A payout that also opens the door to Tier S should
--   cost a near-perfect submission. Same neighbourhood as x_ray (85) and
--   free_tab (90), the other two top-band types.
UPDATE powerup_types
  SET coming_soon = false,
      enabled_by_default = true,
      immediate_use = true,      -- the spin fires on earn; there is nothing to hold
      holdable = false,          -- (same reason)
      category = 'self',
      default_inverse = false,   -- earned via the normal ladder, not the inverse channel
      default_min_score_pct = 80,
      default_max_score_pct = 100,
      tier = 'A',
      name = 'Power Spin',
      icon = '🎡',
      sort_order = 180,
      description = 'Spin the wheel and win another powerup — usually a strong one, sometimes a legendary one. Whatever comes up is yours to keep or use, exactly as if you had earned it.'
  WHERE id = 'power_spin';

-- Insert the row on a database that has never seen power_spin. Every clause
-- matches the UPDATE above, so both paths land on identical state.
INSERT INTO powerup_types
  (id, name, category, description, immediate_use, holdable,
   default_min_score_pct, default_max_score_pct, icon, sort_order,
   enabled_by_default, coming_soon, default_inverse, tier)
VALUES
  ('power_spin', 'Power Spin', 'self',
   'Spin the wheel and win another powerup — usually a strong one, sometimes a legendary one. Whatever comes up is yours to keep or use, exactly as if you had earned it.',
   true, false, 80, 100, '🎡', 180, true, false, false, 'A')
ON CONFLICT (id) DO NOTHING;

-- ── 4. The A/S split, per set ───────────────────────────────────────────────
-- powerup_config.types.power_spin.tier_s_chance — the probability the wheel
-- reaches for Tier S. 0.15 means 85% A / 15% S, the designed default.
--
-- Read by resolveSpinTierSChance() (src/lib/server/powerups.ts), which falls back
-- to POWER_SPIN_DEFAULT_TIER_S_CHANCE for any value that is missing or outside
-- [0,1] — the same shape resolveDiceRange and resolveXrayBudget use, so this is a
-- SETTING a later console can tune, not a constant buried in the roll.
--
-- TIER S IS EMPTY TODAY: resurrection and all_seeing_eye do not exist yet, so
-- 15% of spins will select a tier with no members. That is not a bug to seed
-- around — the roll falls back to Tier A silently (a player sees a normal Tier A
-- result, never a broken one), and the 15% starts paying out the moment the two
-- S powerups are built, with no config change needed.
--
-- Same jsonb_set shape as 0070's dice-range seed and 0071's lifeline chance:
-- preserves sibling keys, and only touches sets that have no tier_s_chance yet so
-- a host who retunes it is never overwritten by a re-run.
UPDATE game_sets
  SET powerup_config = jsonb_set(
        jsonb_set(
          COALESCE(powerup_config, '{}'::jsonb),
          '{types}',
          COALESCE(powerup_config -> 'types', '{}'::jsonb),
          true
        ),
        '{types,power_spin}',
        COALESCE(powerup_config -> 'types' -> 'power_spin', '{}'::jsonb)
          || '{"tier_s_chance": 0.15}'::jsonb,
        true
      )
  WHERE COALESCE(powerup_config -> 'types' -> 'power_spin' -> 'tier_s_chance', 'null'::jsonb)
        = 'null'::jsonb;
