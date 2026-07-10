-- Migration 0047: Powerups P3b — activation schema additions
-- Extends team_effects and team_powerups for full activation support.

-- 1. Add source_team_powerup_id to team_effects (links effect → originating held powerup)
ALTER TABLE team_effects
    ADD COLUMN IF NOT EXISTS source_team_powerup_id uuid REFERENCES team_powerups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS team_effects_source_idx ON team_effects(source_team_powerup_id)
    WHERE source_team_powerup_id IS NOT NULL;

-- 2. Expand team_powerups.status to include 'active' (window/pending effects running)
--    and 'consumed' (instant effects fully used up).
ALTER TABLE team_powerups
    DROP CONSTRAINT IF EXISTS team_powerups_status_check;

ALTER TABLE team_powerups
    ADD CONSTRAINT team_powerups_status_check
    CHECK (status IN ('pending', 'held', 'used', 'lost', 'active', 'consumed'));
