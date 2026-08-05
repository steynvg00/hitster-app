-- 0073_enable_all_seeing_eye.sql
--
-- All Seeing Eye — the first powerup that READS another team's play. Every other
-- offensive type acts on a team (freeze, time_drain, tap_to_break, give_a_shot);
-- this one looks at what they wrote.
--
-- ── The mechanic (implemented in code, recorded here) ───────────────────────
--   Activated during a challenge. Shows every OTHER team that has already
--   finished this same challenge (submissions.is_final = true), with all of their
--   filled-in fields — and NO right/wrong marking of any kind.
--
--   Refusal: if no other team has finished yet there is nothing to see, so the
--   activation is refused and the powerup STAYS HELD. Same posture as lifeline's
--   time gate and free_answer's challenge gate (src/lib/server/powerups.ts) — an
--   Eye must never be burned by a click that showed nothing.
--
--   Holdable, not immediate_use: the team chooses WHEN to look, and timing is the
--   whole skill of it (look too early and nobody has finished).
--
--   Category 'offensive' but NOT targeted: it reads every finished team at once,
--   so there is no target picker. It is deliberately absent from
--   TARGETED_POWERUP_IDS (src/lib/powerups-meta.ts), which is what the picker is
--   driven from — so nothing extra is needed to keep the picker away.
--
--   Tier S (migration 0072's classification): this is the top band, alongside
--   resurrection when that is built. Until then Tier S has exactly one member,
--   which also means Power Spin's 15% Tier-S branch starts paying out — it has
--   been silently falling back to Tier A since 0072, and this row is what makes
--   that branch live. Nothing about the roll changes; the pool simply stops being
--   empty.
--
-- ── What is NOT in this migration ──────────────────────────────────────────
-- No schema change. team_effects.effect_type is plain text with no CHECK
-- (0044_powerups_runtime.sql) and payload is jsonb, so the Eye's snapshot is
-- stored as ONE already-consumed row, effect_type='all_seeing_eye', payload
-- {challenge_id, teams:[…]}. Consumed rows are invisible to loadActiveEffects and
-- deriveEffectModifiers has no case for this type, so the Eye cannot move a
-- single point by two independent routes. The challenge page reads the row back
-- on load the same way it reads lifeline's, which is what makes the panel survive
-- a refresh.
--
-- CRITICALLY: what is stored in that payload is ALREADY STRIPPED. The scoring
-- half of a submission (scored, total, breakdown, matched_source_track_id, and
-- the submissions.status column) never enters the row, so it cannot reach the
-- browser from the read-back path either. The strip happens once, server-side, in
-- stripAnswersForEye() — see src/lib/server/powerups.ts.
--
-- Idempotent: catalog flags restated by UPDATE, row INSERTed only if absent, and
-- a config seed that only touches sets without the key. Safe to re-run.
--
-- Run manually in Supabase SQL Editor.

-- ── 1. all_seeing_eye: live, holdable, tier S ──────────────────────────────
-- default_min_score_pct 85: a Tier S powerup should cost a near-perfect
-- submission, the same neighbourhood as x_ray (85) and free_tab (90).
UPDATE powerup_types
  SET coming_soon = false,
      enabled_by_default = true,
      holdable = true,          -- the team chooses WHEN to look
      immediate_use = false,    -- (same reason)
      category = 'offensive',
      default_inverse = false,  -- earned via the normal ladder
      default_min_score_pct = 85,
      default_max_score_pct = 100,
      tier = 'S',
      name = 'All Seeing Eye',
      icon = '👁️',
      sort_order = 190,
      description = 'Open the Eye during a challenge to see what every team that has already finished wrote down — all of their answers, exactly as they typed them. You are not told which of them are right.'
  WHERE id = 'all_seeing_eye';

-- Insert on a database that has never seen the row. Every value matches the
-- UPDATE above, so both paths land on identical state.
INSERT INTO powerup_types
  (id, name, category, description, immediate_use, holdable,
   default_min_score_pct, default_max_score_pct, icon, sort_order,
   enabled_by_default, coming_soon, default_inverse, tier)
VALUES
  ('all_seeing_eye', 'All Seeing Eye', 'offensive',
   'Open the Eye during a challenge to see what every team that has already finished wrote down — all of their answers, exactly as they typed them. You are not told which of them are right.',
   false, true, 85, 100, '👁️', 190, true, false, false, 'S')
ON CONFLICT (id) DO NOTHING;

-- ── 2. The show-scores switch, per set ─────────────────────────────────────
-- powerup_config.types.all_seeing_eye.show_scores — whether the panel also shows
-- each finished team's TOTAL score next to their answers.
--
-- DEFAULT FALSE, and that default is the point rather than caution: a score is a
-- correctness signal. "Team Red scored 45 of 45" tells you their three answers
-- are all right, which is exactly what the Eye is designed NOT to tell you — the
-- whole mechanic is reading other teams' answers without being told which to
-- trust. Turning this on trades that tension for convenience, so it is a
-- deliberate host choice, never the default.
--
-- Read by resolveEyeShowScores() (src/lib/server/powerups.ts), which treats
-- anything that is not exactly `true` as false. Same per-type override map the
-- console already writes for enabled/threshold/chance, and the same jsonb_set
-- shape as 0070's dice range, 0071's lifeline chance and 0072's tier_s_chance:
-- sibling keys preserved, and only sets WITHOUT the key are touched so a host who
-- turns it on is never reset by a re-run.
UPDATE game_sets
  SET powerup_config = jsonb_set(
        jsonb_set(
          COALESCE(powerup_config, '{}'::jsonb),
          '{types}',
          COALESCE(powerup_config -> 'types', '{}'::jsonb),
          true
        ),
        '{types,all_seeing_eye}',
        COALESCE(powerup_config -> 'types' -> 'all_seeing_eye', '{}'::jsonb)
          || '{"show_scores": false}'::jsonb,
        true
      )
  WHERE COALESCE(powerup_config -> 'types' -> 'all_seeing_eye' -> 'show_scores', 'null'::jsonb)
        = 'null'::jsonb;
