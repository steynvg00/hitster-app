-- 0070_enable_group_a_powerups.sql
--
-- Group A: the three powerups that ride on the free_answer reveal machinery.
--
--   lucky_dice  (self, IMMEDIATE-USE)  — roll an integer in a configured range,
--                                        award it as flat bonus points.
--   x_ray       (information, holdable) — the team picks up to 5 answer cells of
--                                        the tab it is on; each is revealed.
--   free_tab    (information, holdable) — the team picks ONE tab; every field of
--                                        every slot of that tab is revealed.
--
-- ── Catalog state this migration was written against ────────────────────────
-- Verified with a read-only SELECT on the live database before writing:
--
--   lucky_dice  EXISTS as a coming_soon placeholder from 0056 — but with
--               holdable=true / immediate_use=false, which is the WRONG shape for
--               the mechanic that was actually built (a dice roll has no choice to
--               make, so there is nothing to hold: it fires on earn like
--               bonus_points). This migration flips both flags.
--   x_ray       does NOT exist — inserted here.
--   free_tab    does NOT exist — inserted here.
--
-- ── Why no schema change ────────────────────────────────────────────────────
-- Nothing new is stored per reveal: x_ray and free_tab write the SAME
-- team_effects rows free_answer writes (effect_type='free_answer', payload
-- {field, value, challenge_id, tab_id, slot_index}), one row per revealed cell,
-- and the challenge page's existing reveal load rebuilds all of them unchanged.
-- The only extra payload key is `source` ('x_ray' | 'free_tab'), which the reader
-- ignores — it exists so a row can be traced back to the powerup that produced it
-- without a join through source_team_powerup_id.
--
-- lucky_dice likewise writes an ordinary bonus_points effect row (payload
-- {value: <roll>, source:'lucky_dice', dice_min, dice_max}), so it flows through
-- the scoring path bonus_points already uses — no scoring change, no new column.
--
-- ── Dice range lives in powerup_config, not in code ─────────────────────────
-- Stored per set at powerup_config.types.lucky_dice.{dice_min,dice_max}, the same
-- per-type override map the console already writes (enabled / threshold / chance)
-- and that parseConfig (src/lib/server/powerups.ts) already round-trips — so a
-- later settings UI edits it exactly like every other per-type setting, and the
-- range is NOT hardcoded in the activation branch. resolveDiceRange() falls back
-- to 1–6 whenever the keys are absent or invalid, so the seeding below is a
-- convenience for the future UI, never a requirement for the mechanic to work.
--
-- Idempotent: catalog flags are plain UPDATEs, the two new rows use
-- ON CONFLICT (id) DO UPDATE, and the config seed only touches sets that do not
-- already carry a dice range. Safe to re-run.
--
-- Run manually in Supabase SQL Editor.

-- ── 1. lucky_dice: placeholder → live immediate-use self powerup ────────────
UPDATE powerup_types
  SET coming_soon = false,
      enabled_by_default = true,
      holdable = false,          -- nothing to decide later: the roll IS the effect
      immediate_use = true,      -- auto-activates on earn, exactly like bonus_points
      category = 'self',
      name = 'Lucky Dice',
      icon = '🍀',
      default_min_score_pct = 50,
      default_max_score_pct = 100,
      description = 'Roll the dice for a random points bonus — the number you roll is the number of points you get on your next submission.'
  WHERE id = 'lucky_dice';

-- ── 2. x_ray + free_tab: new information powerups ───────────────────────────
-- Both holdable (the team must choose WHAT to reveal, so they cannot fire on
-- earn), both gated behind a running challenge attempt at activation time — the
-- same gate free_answer uses, enforced in code, not here.
--
-- Thresholds sit ABOVE free_answer's 80 because both reveal strictly more than it
-- does: x_ray up to 5 cells (85), free_tab an entire tab (90).
INSERT INTO powerup_types
  (id, name, category, description, immediate_use, holdable,
   default_min_score_pct, default_max_score_pct, icon, sort_order,
   enabled_by_default, coming_soon)
VALUES
  ('x_ray',    'X-Ray',    'information',
   'Pick up to 5 answers on the tab you are playing — all of them are revealed and filled in for you.',
   false, true, 85, 100, '🔎', 160, true, false),
  ('free_tab', 'Free Tab', 'information',
   'Pick one tab — every field of every track on that tab is revealed and filled in for you.',
   false, true, 90, 100, '🗂️', 170, true, false)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  immediate_use = EXCLUDED.immediate_use,
  holdable = EXCLUDED.holdable,
  default_min_score_pct = EXCLUDED.default_min_score_pct,
  default_max_score_pct = EXCLUDED.default_max_score_pct,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  enabled_by_default = EXCLUDED.enabled_by_default,
  coming_soon = EXCLUDED.coming_soon;

-- ── 3. Seed lucky_dice's default range into every set's powerup_config ──────
-- Writes powerup_config.types.lucky_dice = {"dice_min":1,"dice_max":6} while
-- preserving any sibling keys that type already has (enabled / threshold /
-- chance). Only sets WITHOUT a dice_min are touched, so a host who later tunes
-- the range is never overwritten by a re-run.
UPDATE game_sets
  SET powerup_config = jsonb_set(
        jsonb_set(
          COALESCE(powerup_config, '{}'::jsonb),
          '{types}',
          COALESCE(powerup_config -> 'types', '{}'::jsonb),
          true
        ),
        '{types,lucky_dice}',
        COALESCE(powerup_config -> 'types' -> 'lucky_dice', '{}'::jsonb)
          || '{"dice_min": 1, "dice_max": 6}'::jsonb,
        true
      )
  WHERE COALESCE(powerup_config -> 'types' -> 'lucky_dice' -> 'dice_min', 'null'::jsonb) = 'null'::jsonb;
