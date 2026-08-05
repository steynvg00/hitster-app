-- 0074_enable_resurrection.sql
--
-- Resurrection — the only powerup that reaches BACKWARDS. Every other type acts
-- on a challenge that is still open (or on another team's clock); this one
-- re-opens a challenge the team has already finished and lets them play it again.
--
-- ── The mechanic (implemented in code, recorded here) ───────────────────────
--   Activated on one of the team's OWN challenges that already has a finished
--   submission (submissions.is_final = true). It re-opens that challenge:
--
--     - the team's challenge_attempts row is restarted (started_at = now,
--       ended_at = NULL) with a SHORT clock — one third of the challenge's
--       timer_seconds, rounded, minimum 1s. See timer_override_seconds below.
--     - the submission is UNLOCKED (is_final = false), which is what lets the
--       team submit that challenge a second time.
--
--   Refusal: no finished submission for that challenge → the activation fails and
--   the powerup STAYS HELD. Same posture as lifeline's time gate, free_answer's
--   challenge gate and the Eye's "nobody has finished yet" (all in
--   src/lib/server/powerups.ts). A one-shot Tier S powerup must never be burned
--   on a click that changed nothing.
--
--   Settlement: the retry is scored by the ORDINARY pipeline
--   (scoreAndPersistSubmission → scoreSubmission → computeBreakdown). Powerups
--   active during the retry count exactly as they would on a first attempt. Only
--   the team-score line differs: the DIFFERENCE is booked, never a rollback —
--
--       replace (default)  teams.score += new_final - old_final
--       best               teams.score += MAX(0, new_final - old_final)
--
--   where old_final is the breakdown.final of the FIRST submission, captured into
--   the ticket's payload BEFORE anything is re-opened. Crown, streak and any
--   powerups the first attempt earned are NOT rolled back; they re-derive from
--   the new total the same way a normal submit re-derives them.
--
--   Holdable, not immediate_use: WHICH challenge to resurrect, and when, is the
--   whole decision.
--
--   Category 'defensive' and NOT targeted: it only ever touches the caster's own
--   challenge, so it is deliberately absent from TARGETED_POWERUP_IDS
--   (src/lib/powerups-meta.ts) and no target picker appears.
--
--   Tier S: this row completes the top band (all_seeing_eye, 0073, was its only
--   member). Power Spin's Tier-S branch simply gains a second face; nothing about
--   the roll changes.
--
-- ── The one schema change ──────────────────────────────────────────────────
-- challenge_attempts.timer_override_seconds — this attempt's own clock, in
-- seconds, overriding challenges.timer_seconds for THIS team on THIS challenge.
-- NULL for every attempt that is not a resurrection retry, which is all of them
-- until this powerup fires.
--
-- It exists because the 1/3 clock has nowhere else to honestly live. The
-- deadline is computed in two places — /api/auto-submit's sweep and the
-- challenge page's timerEndsAt — and both read `started_at + timer_seconds`. The
-- alternative was to fake a negative entry in the time_boost/freeze/time_drain
-- sum that the sweep already applies, i.e. to write "someone drained 40 seconds
-- off this team" when nobody did. A nullable column that says what it means
-- costs one COALESCE in each of those two places and lies to no one.
--
-- The unique constraint (challenge_id, team_id) on challenge_attempts
-- (0014_challenge_attempts.sql) is deliberately left alone: the retry RESTARTS
-- the existing row rather than inserting a second one, so there is never a
-- second live attempt for the same (challenge, team) — and therefore never an
-- old attempt for the sweep to fire on.
--
-- Idempotent: column added IF NOT EXISTS, catalog flags restated by UPDATE, row
-- INSERTed only if absent, config seed touches only sets without the key. Safe
-- to re-run.
--
-- Run manually in Supabase SQL Editor.

-- ── 1. Per-attempt clock override ──────────────────────────────────────────
ALTER TABLE challenge_attempts
  ADD COLUMN IF NOT EXISTS timer_override_seconds integer;

COMMENT ON COLUMN challenge_attempts.timer_override_seconds IS
  'This attempt''s own timer in seconds, overriding challenges.timer_seconds. Set by a Resurrection retry (1/3 of the original); NULL for a normal attempt.';

-- ── 2. resurrection: live, holdable, tier S ────────────────────────────────
-- default_min_score_pct 90: the most powerful type in the game should cost the
-- best submission — one rung above all_seeing_eye (85), level with free_tab (90).
--
-- default_inverse false: earned through the normal ladder. Earning it by playing
-- WELL and spending it on an earlier bad challenge is the intended tension; an
-- inverse Resurrection would hand a retry to the team that just needed one,
-- which is a different (and much softer) powerup.
UPDATE powerup_types
  SET coming_soon = false,
      enabled_by_default = true,
      holdable = true,          -- which challenge, and when, is the whole choice
      immediate_use = false,    -- (same reason)
      category = 'defensive',   -- only ever touches the caster's own challenge
      default_inverse = false,  -- earned via the normal ladder
      default_min_score_pct = 90,
      default_max_score_pct = 100,
      tier = 'S',
      name = 'Resurrection',
      icon = '💀',
      sort_order = 200,
      description = 'Bring one of your finished challenges back from the dead and play it again — on a third of the original clock. Your score changes by the difference between the new attempt and the old one.'
  WHERE id = 'resurrection';

-- Insert on a database that has never seen the row. Every value matches the
-- UPDATE above, so both paths land on identical state.
INSERT INTO powerup_types
  (id, name, category, description, immediate_use, holdable,
   default_min_score_pct, default_max_score_pct, icon, sort_order,
   enabled_by_default, coming_soon, default_inverse, tier)
VALUES
  ('resurrection', 'Resurrection', 'defensive',
   'Bring one of your finished challenges back from the dead and play it again — on a third of the original clock. Your score changes by the difference between the new attempt and the old one.',
   false, true, 90, 100, '💀', 200, true, false, false, 'S')
ON CONFLICT (id) DO NOTHING;

-- ── 3. The score-mode switch, per set ──────────────────────────────────────
-- powerup_config.types.resurrection.score_mode — how the retry settles against
-- the original:
--
--   'replace' (default)  the new attempt REPLACES the old one, for better or
--                        worse: teams.score += new_final - old_final. A worse
--                        retry costs points, and abandoning a retry (letting the
--                        1/3 clock run out) scores an empty draft like any other
--                        expired challenge — which under this mode means losing
--                        the original points. That risk is the powerup's price.
--
--   'best'               only an improvement counts:
--                        teams.score += MAX(0, new_final - old_final). A worse
--                        retry is free, which makes Resurrection pure upside.
--
-- DEFAULT 'replace' because the choice of WHEN to resurrect should carry weight —
-- a risk-free retry is a button, not a decision. A host who wants the gentler
-- version flips one key.
--
-- Read by resolveResurrectionScoreMode() (src/lib/server/powerups.ts), which
-- treats anything that is not exactly 'best' as 'replace'. Same per-type override
-- map the console already writes for enabled/threshold/chance, and the same
-- jsonb_set shape as 0070's dice range, 0071's lifeline chance, 0072's
-- tier_s_chance and 0073's show_scores: sibling keys preserved, and only sets
-- WITHOUT the key are touched so a host who changed it is never reset by a re-run.
UPDATE game_sets
  SET powerup_config = jsonb_set(
        jsonb_set(
          COALESCE(powerup_config, '{}'::jsonb),
          '{types}',
          COALESCE(powerup_config -> 'types', '{}'::jsonb),
          true
        ),
        '{types,resurrection}',
        COALESCE(powerup_config -> 'types' -> 'resurrection', '{}'::jsonb)
          || '{"score_mode": "replace"}'::jsonb,
        true
      )
  WHERE COALESCE(powerup_config -> 'types' -> 'resurrection' -> 'score_mode', 'null'::jsonb)
        = 'null'::jsonb;
