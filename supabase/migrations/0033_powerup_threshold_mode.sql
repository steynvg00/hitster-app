-- Migration 0033: powerup threshold mode
-- Adds powerup_mode to game_sets, renames token_earning_config → powerup_config,
-- resets existing rows to threshold defaults, and adds threshold tracking columns to teams.

-- 1) Add game_sets.powerup_mode
DO $$ BEGIN
  ALTER TABLE game_sets ADD COLUMN IF NOT EXISTS powerup_mode text NOT NULL
    DEFAULT 'threshold' CHECK (powerup_mode IN ('threshold', 'token_shop'));
EXCEPTION WHEN others THEN null; END $$;

-- 2) Rename token_earning_config → powerup_config
DO $$ BEGIN
  ALTER TABLE game_sets RENAME COLUMN token_earning_config TO powerup_config;
EXCEPTION WHEN others THEN null; END $$;

-- 3) Update default of powerup_config to threshold-mode defaults
DO $$ BEGIN
  ALTER TABLE game_sets ALTER COLUMN powerup_config SET DEFAULT
    '{"thresholds_percent": [25, 50, 75]}'::jsonb;
EXCEPTION WHEN others THEN null; END $$;

-- 4) Reset existing rows to the new threshold default (dev env, no real games yet)
UPDATE game_sets SET powerup_config = '{"thresholds_percent": [25, 50, 75]}'::jsonb;

-- 5) New columns on teams
DO $$ BEGIN
  ALTER TABLE teams ADD COLUMN IF NOT EXISTS held_powerups jsonb NOT NULL DEFAULT '[]'::jsonb;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE teams ADD COLUMN IF NOT EXISTS last_threshold_crossed int NOT NULL DEFAULT 0;
EXCEPTION WHEN others THEN null; END $$;
