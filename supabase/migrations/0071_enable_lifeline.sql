-- 0071_enable_lifeline.sql
--
-- Flips `lifeline` from the coming_soon placeholder seeded by migration 0056 to a
-- live, holdable DEFENSIVE powerup. Same shape as the go-live migrations
-- 0057-0060 and 0069, so the catalog side is nothing new — only the flags plus a
-- description that states the real mechanic.
--
-- ── The mechanic (implemented in code, recorded here) ────────────────────────
--   Activation (src/lib/server/powerups.ts, 'lifeline' branch) is gated on TIME,
--   which no other powerup does: it needs an OPEN challenge_attempt on this
--   challenge AND at least 50% of that attempt's clock elapsed. The elapsed
--   fraction is computed server-side from challenge_attempts.started_at against
--   the SAME boost-adjusted deadline /api/auto-submit uses
--   (timer_seconds + SUM(payload.added_seconds) over time_boost/freeze/
--   time_drain), so the gate and the deadline the team is racing sit on one
--   timeline. The client countdown is never an input. An untimed challenge
--   (timer_seconds NULL/0) has no halfway point and is refused, the same way
--   time_boost refuses one.
--
--   Effect: a partial reveal across EVERY (tab, slot, field) of the challenge,
--   but only on the cells the team has left EMPTY or answered WRONG. A cell that
--   already scores full points gets nothing. Each hint is the correct answer
--   MASKED — first character of every word kept, the rest underscored
--   ("Raiders Of Rampage" -> "R______ O_ R______"). The unmasked answer never
--   leaves the server.
--
--   It is a HINT, not a filled-in answer: the team still types. Lifeline does
--   NOT go through applyRevealToDraft (the free_answer/x_ray/free_tab pre-fill
--   path) — it renders as a separate read-only line beside the field.
--
-- ── Known side effect, accepted by design ───────────────────────────────────
--   Because only empty/wrong cells get a hint, the ABSENCE of a hint tells the
--   team that cell is already correct. That is inherent to the "only empty or
--   wrong" rule, not an oversight.
--
-- ── Why no schema change ────────────────────────────────────────────────────
-- team_effects.effect_type is plain text with no CHECK constraint
-- (0044_powerups_runtime.sql line 40, verified read-only against the live
-- database before writing this file), and payload is jsonb — so the hint list
-- is stored as one already-consumed row, effect_type='lifeline', payload
-- {challenge_id, hints:[{tab_id, slot_index, field, mask}]}. Consumed rows are
-- invisible to loadActiveEffects and deriveEffectModifiers ignores unknown
-- effect types anyway, so a lifeline row has zero scoring impact by two
-- independent routes. The challenge page reads the row back on load exactly the
-- way it already reads free_answer's consumed reveal rows, which is what makes
-- the hint survive a refresh. src/lib/types/database.ts is untouched: no column
-- is added and powerup_types already carries every flag set below.
--
-- ── Earn condition ──────────────────────────────────────────────────────────
-- The intent is "a team that is doing badly gets a lifeline": LOW score AND LOW
-- position. Only the first half is expressible in the existing earn structure.
--
--   LOW SCORE — declarative, set here. default_inverse=true routes lifeline
--   through planAwards' inverse channel (src/lib/server/powerups.ts), which
--   fires when submissionPct < the bound instead of >= a threshold;
--   default_max_score_pct=40 is that bound. Identical to penalty_shot
--   (0057_penalty_shot_live.sql), the mechanic this reuses.
--
--   LOW POSITION — NOT expressible. planAwards' PlanContext carries
--   submissionPct, cumulativePct, thresholdMode, bandMode and
--   lastThresholdCrossed; a team's RANK is not among them and nothing in the
--   earning path computes one. Adding it means a new PlanContext field plus a
--   rank query in awardPowerups — a change to shared earning logic that would
--   touch every powerup, so it is deliberately NOT bundled into this migration.
--   Until that lands, lifeline is earned on low score alone.
--
-- The inverse channel rolls chance (override ?? 1), so at the default every
-- sub-40% submission would grant one. Section 3 seeds a 0.5 chance into each
-- set's powerup_config.types.lifeline — the same per-type override map the
-- console already writes and parseConfig already round-trips, so a host can
-- retune it later like any other per-type setting.
--
-- Idempotent: a plain UPDATE of catalog flags, and a config seed that only
-- touches sets without a lifeline chance. Safe to re-run.
--
-- Run manually in Supabase SQL Editor.

-- ── 1. lifeline: placeholder → live defensive powerup ───────────────────────
UPDATE powerup_types
  SET coming_soon = false,
      enabled_by_default = true,
      holdable = true,           -- the team chooses WHEN, so it cannot fire on earn
      immediate_use = false,     -- (same reason)
      category = 'defensive',
      default_inverse = true,    -- earned via the inverse channel (score BELOW the bound)
      default_min_score_pct = 0,
      default_max_score_pct = 40,
      name = 'Lifeline',
      icon = '🆘',
      sort_order = 130,
      description = 'Stuck halfway through a challenge? Activate for a masked hint on every answer you have not got right yet — first letter of each word, the rest blanked. You still type it yourself.'
  WHERE id = 'lifeline';

-- ── 2. Insert the row if a database predates 0056 ───────────────────────────
-- Every live database has this row (0056 seeded it), so this is a no-op there.
-- It exists so a rebuilt-from-scratch database that skipped the placeholder
-- migration still lands on the same catalog state.
INSERT INTO powerup_types
  (id, name, category, description, immediate_use, holdable,
   default_min_score_pct, default_max_score_pct, icon, sort_order,
   enabled_by_default, coming_soon, default_inverse)
VALUES
  ('lifeline', 'Lifeline', 'defensive',
   'Stuck halfway through a challenge? Activate for a masked hint on every answer you have not got right yet — first letter of each word, the rest blanked. You still type it yourself.',
   false, true, 0, 40, '🆘', 130, true, false, true)
ON CONFLICT (id) DO NOTHING;

-- ── 3. Seed the earn chance into every set's powerup_config ─────────────────
-- Writes powerup_config.types.lifeline = {"chance": 0.5} while preserving any
-- sibling keys that type already has (enabled / threshold / inverse). Only sets
-- WITHOUT a lifeline chance are touched, so a host who later tunes it is never
-- overwritten by a re-run. Same jsonb_set shape as 0070's dice-range seed.
UPDATE game_sets
  SET powerup_config = jsonb_set(
        jsonb_set(
          COALESCE(powerup_config, '{}'::jsonb),
          '{types}',
          COALESCE(powerup_config -> 'types', '{}'::jsonb),
          true
        ),
        '{types,lifeline}',
        COALESCE(powerup_config -> 'types' -> 'lifeline', '{}'::jsonb)
          || '{"chance": 0.5}'::jsonb,
        true
      )
  WHERE COALESCE(powerup_config -> 'types' -> 'lifeline' -> 'chance', 'null'::jsonb) = 'null'::jsonb;
