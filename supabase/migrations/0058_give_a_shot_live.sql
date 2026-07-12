-- 0058_give_a_shot_live.sql
--
-- Offensive powerups stuk 1/3: targeting infrastructure + shield block +
-- give_a_shot as the first live cross-team attack. This migration flips ONLY
-- give_a_shot from a coming_soon placeholder (migration 0056) to live — the
-- three other offensive types (freeze, time_drain, tap_to_break) stay
-- coming_soon until stuks 2-3. Template: penalty_shot's 0057 flip.
--
-- give_a_shot is the FIRST powerup that acts on another team. The runtime model
-- needs NO schema change for targeting:
--   * An offensive effect is a team_effects row whose team_id = the TARGET team
--     (team_effects.team_id has always meant "the affected team").
--   * The caster is recoverable via source_team_powerup_id → team_powerups.team_id,
--     and additionally denormalized into payload.source_team_id / source_team_name
--     so the target's realtime client renders "from Team Red" without a join.
--   * Teams-in-set derive from TEAM_COLOR_ORDER.slice(0, game_sets.team_count),
--     the same derivation the /team lobby already uses — no set_teams table.
--
-- Shield (seeded but never consumed until now — audit C2) becomes the counter:
-- an offensive activation checks the target for an active shield team_effect and,
-- if present, atomically consumes it and drops the attack (see powerups.ts).
--
-- Run manually in Supabase SQL Editor.

UPDATE powerup_types
  SET coming_soon = false,
      enabled_by_default = false,   -- opt-in: a host enables it per set from the console
      immediate_use = false,        -- holdable → stored, then activated WITH a target
      holdable = true,
      default_inverse = false,      -- earns via the NORMAL ladder (high score), not inverse
      default_min_score_pct = 50,   -- earnable from a decent score upward
      default_max_score_pct = 100,
      category = 'social',          -- already 'social' from 0056; restated for clarity (inside 0044 CHECK)
      name = 'Give a Shot',
      icon = '🥂',
      description = 'Target another team — they take a real-world shot 🥂. Purely social, no score impact. Blocked by Shield.'
  WHERE id = 'give_a_shot';
