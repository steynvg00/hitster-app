-- 0069_enable_double_down.sql
--
-- Flips double_down from a coming_soon placeholder (seeded by migration 0056)
-- to a live, holdable defensive powerup. Same shape as the go-live migrations
-- 0057-0060, so nothing here is new machinery — only the catalog flags plus a
-- description that states the real mechanic.
--
-- ── Why no schema change ─────────────────────────────────────────────────────
-- Double Down is the first powerup that carries a TEAM-CHOSEN parameter (the
-- predicted percentage) from activation through to scoring. It needs no new
-- column: team_effects.payload is already jsonb (0044_powerups_runtime.sql line
-- 41, verified read-only against the live database before writing this file), and
-- every other powerup already stores structured data there — free_answer writes
-- {field, value, tab_id, slot_index, challenge_id}, hard_gaan writes {multiplier,
-- window_minutes}. Double Down writes {predicted_pct: <0-100>} into that same
-- column, so src/lib/types/database.ts is untouched.
--
-- ── The mechanic (implemented in code, documented here for the record) ───────
--   Activation (src/lib/server/powerups.ts, 'double_down' branch): the team picks
--   g between 0 and 100 BEFORE starting a challenge. Guarded three ways — g must
--   be an integer in [0,100], the team must have no open challenge_attempt in
--   this set (you cannot gamble once you have heard the audio), and only one
--   Double Down may be live at a time (the same one-at-a-time rule shield uses).
--
--   Scoring (src/lib/server/scoring.ts, computeBreakdown): score% is the
--   bonus-excluded threshold pair — the SAME numerator/denominator the powerup
--   earn-% uses (thresholdOfFields, $lib/threshold) — and then
--       score% >= g  →  x(1 + g/100)     hit
--       score% <  g  →  x(1 - g/100)     miss
--   g=0 resolves to x1.0 either way, so "predict nothing" is a genuine no-op
--   rather than a trap. The resolved multiplier joins the SAME additive-delta sum
--   as hard_gaan and single_event_mult -- base x (1 + SUM(m_i - 1)) -- so stacked
--   powerups add instead of compounding.
--
--   thresholdMax = 0 (a tab with no source tracks, hence no percentage to hit):
--   the multiplier resolves to 1.0 and the effect is still consumed. This follows
--   the C3a-1 posture that a zero threshold yields no measurable percentage
--   (src/lib/server/submit.ts: `thresholdMax > 0 ? ... : 0`) rather than scoring
--   it as a 0% miss and punishing a team for a mis-configured challenge.
--
-- ── Flags ────────────────────────────────────────────────────────────────────
--   coming_soon        false  -- console shows real controls instead of the stub
--   enabled_by_default true   -- earnable without a per-set toggle, matching the
--                                host decision recorded in migration 0062
--   holdable           true   -- stored and fired later, never on earn: the team
--                                must choose g, so it cannot auto-activate
--   immediate_use      false  -- (same reason)
--
-- Idempotent: a plain UPDATE of catalog flags, safe to re-run.
--
-- Run manually in Supabase SQL Editor.

UPDATE powerup_types
  SET coming_soon = false,
      enabled_by_default = true,
      holdable = true,
      immediate_use = false,
      name = 'Double Down',
      icon = '🎰',
      description = 'Predict your score before the challenge starts. Hit your prediction and your points go UP by that percentage — miss it and they go DOWN by it. Predict 0% to play it safe.'
  WHERE id = 'double_down';
