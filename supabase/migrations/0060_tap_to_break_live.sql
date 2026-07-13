-- 0060_tap_to_break_live.sql
--
-- Offensive powerups stuk 3/3 (FINAL): flips tap_to_break from a coming_soon
-- placeholder (migration 0056) to live — the last of the four offensive
-- attacks (give_a_shot, freeze, time_drain, tap_to_break). Same template as
-- 0058/0059's flips. This COMPLETES the offensive powerups feature.
--
-- tap_to_break is the ONE offensive type whose team_effects row is NOT
-- pre-consumed at insert (unlike give_a_shot/freeze/time_drain's marker rows).
-- It stays active (consumed_at IS NULL) until the target taps it out — the
-- existing /api/effects/consume endpoint (built in stuk 1 for give_a_shot's
-- "Drunk!" ack) marks it consumed when the client posts after 20 taps.
-- Because it's non-consumed, loadActiveEffects naturally re-surfaces it on a
-- page reload — persistence across a refresh comes for free, no new mechanism.
--
-- Like freeze/time_drain, it's timer-gated: activatePowerup rejects if the
-- target has no active timed attempt (design B — locking an idle team is
-- pointless), and the target picker greys non-playing teams for it too
-- (tap_to_break added to TIMER_POWERUP_IDS in powerups-meta.ts).
--
-- default_min_score_pct = 70 — rare/nasty, matching freeze's threshold (the
-- heaviest UI of the three timer/lock attacks).
--
-- Run manually in Supabase SQL Editor.

UPDATE powerup_types
  SET coming_soon = false,
      enabled_by_default = false,   -- opt-in: a host enables it per set from the console
      immediate_use = false,        -- holdable → stored, then activated WITH a target
      holdable = true,
      default_inverse = false,      -- earns via the NORMAL ladder (high score), not inverse
      default_min_score_pct = 70,
      default_max_score_pct = 100,
      category = 'offensive',       -- already 'offensive' from 0056; restated for clarity
      name = 'Tap to Break',
      icon = '🔨',
      description = 'Target another team — locks their screen until they tap 20 times to break free. Blocked by Shield.'
  WHERE id = 'tap_to_break';
