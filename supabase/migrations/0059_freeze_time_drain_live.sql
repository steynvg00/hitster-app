-- 0059_freeze_time_drain_live.sql
--
-- Offensive powerups stuk 2/3: flips freeze + time_drain from coming_soon
-- placeholders (migration 0056) to live — the two TIMER offensive attacks.
-- Same template as give_a_shot's 0058 flip. tap_to_break (stuk 3) stays
-- coming_soon.
--
-- Both are payload-driven marker rows on the SAME time_boost convention (see
-- activatePowerup's 'freeze'/'time_drain' cases and /api/auto-submit's widened
-- .in('effect_type', [...]) filter in this piece) — no new runtime concept,
-- just two more values summed into the existing added_seconds deadline math.
--
-- default_min_score_pct: freeze 70, time_drain 60 — rarer/nastier than
-- give_a_shot's 50, matching the existing threshold spread (higher score
-- required to earn a stronger attack).
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
      name = 'Freeze',
      icon = '🧊',
      description = 'Target another team — freezes their challenge timer for 30 seconds and blocks their input. Blocked by Shield.'
  WHERE id = 'freeze';

UPDATE powerup_types
  SET coming_soon = false,
      enabled_by_default = false,
      immediate_use = false,
      holdable = true,
      default_inverse = false,
      default_min_score_pct = 60,
      default_max_score_pct = 100,
      category = 'offensive',
      name = 'Time Drain',
      icon = '⏳',
      description = 'Target another team — drains 15 seconds from their challenge timer. Blocked by Shield.'
  WHERE id = 'time_drain';
