-- 0061_battle_mode_core.sql
--
-- Battle Mode stuk 1/3: core resolution storage. Battle mode is a per-challenge
-- toggle (challenges.points_config.battle = { enabled, ladder } — JSONB, no
-- schema change needed for the config). A battle challenge is played EXACTLY
-- like a normal challenge (full scoring/crown/streak/powerups/earning fire at
-- submit unchanged); battle ADDS a rank-based ladder bonus at round resolution.
--
-- This migration adds only the RESULT + idempotency storage:
--
-- 1. submissions.battle_raw_score — the ranking key, written at submit for a
--    battle challenge = scoredResult.total (base + bonus, PRE-multiplier /
--    PRE-insurance-floor). Teams are ranked by this at resolution. Nullable:
--    only battle-challenge submissions set it.
--
-- 2. set_challenges.battle_resolved_at / battle_ranking — the per-(set,challenge)
--    resolution grain (a challenge can live in multiple sets, each resolves
--    independently). battle_resolved_at is the CAS idempotency guard: resolve
--    claims it atomically (WHERE battle_resolved_at IS NULL) so concurrent
--    last-team submits can't double-award the ladder bonus. battle_ranking is
--    the recorded outcome: [{ team_id, rank, raw_score, awarded, elapsed_seconds }].
--
-- Run manually in Supabase SQL Editor.

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS battle_raw_score integer;

ALTER TABLE set_challenges
  ADD COLUMN IF NOT EXISTS battle_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS battle_ranking jsonb;
