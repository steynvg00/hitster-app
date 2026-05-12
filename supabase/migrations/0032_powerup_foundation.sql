-- Migration 0032: powerup foundation
-- Creates powerups registry, per-set config, usage log.
-- Adds token_balance to teams and powerups_enabled + token_earning_config to game_sets.

-- 1) powerups — global registry
DO $$ BEGIN
  CREATE TABLE powerups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    description text NOT NULL,
    category text NOT NULL CHECK (category IN ('offensive','defensive','information','social','self')),
    default_cost int NOT NULL DEFAULT 3,
    default_visibility text NOT NULL DEFAULT 'silent' CHECK (default_visibility IN ('public','target_only','hidden','silent')),
    target_type text NOT NULL CHECK (target_type IN ('self','team','all_others','none')),
    effect_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    sort_order int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  );
EXCEPTION WHEN duplicate_table THEN null; END $$;

-- 2) set_powerups — per-set overrides
DO $$ BEGIN
  CREATE TABLE set_powerups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id uuid NOT NULL REFERENCES game_sets(id) ON DELETE CASCADE,
    powerup_id uuid NOT NULL REFERENCES powerups(id) ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT true,
    cost_override int,
    visibility_override text CHECK (visibility_override IS NULL OR visibility_override IN ('public','target_only','hidden','silent')),
    effect_payload_override jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (set_id, powerup_id)
  );
EXCEPTION WHEN duplicate_table THEN null; END $$;

-- 3) powerup_usages — activation log
DO $$ BEGIN
  CREATE TABLE powerup_usages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id uuid NOT NULL REFERENCES game_sets(id) ON DELETE CASCADE,
    powerup_id uuid NOT NULL REFERENCES powerups(id) ON DELETE CASCADE,
    attacker_team_id uuid NOT NULL REFERENCES teams(id),
    target_team_id uuid REFERENCES teams(id),
    challenge_id uuid REFERENCES challenges(id),
    cost_paid int NOT NULL,
    used_at timestamptz NOT NULL DEFAULT now(),
    effect_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    effect_ends_at timestamptz,
    effect_resolved boolean NOT NULL DEFAULT false,
    visibility text NOT NULL
  );
EXCEPTION WHEN duplicate_table THEN null; END $$;

-- 4) New columns on game_sets
DO $$ BEGIN
  ALTER TABLE game_sets ADD COLUMN IF NOT EXISTS powerups_enabled boolean NOT NULL DEFAULT false;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE game_sets ADD COLUMN IF NOT EXISTS token_earning_config jsonb NOT NULL DEFAULT '{
    "starting_tokens": 0,
    "per_correct_challenge": 1,
    "streak_bonuses": [{"streak": 3, "bonus": 2}, {"streak": 5, "bonus": 5}],
    "time_tick_minutes": null,
    "tokens_per_tick": 1
  }'::jsonb;
EXCEPTION WHEN others THEN null; END $$;

-- 5) New column on teams
DO $$ BEGIN
  ALTER TABLE teams ADD COLUMN IF NOT EXISTS token_balance int NOT NULL DEFAULT 0;
EXCEPTION WHEN others THEN null; END $$;

-- 6) Seed powerups
INSERT INTO powerups (slug, name, description, category, default_cost, default_visibility, target_type, effect_payload, sort_order)
VALUES
  ('freeze',       'Freeze',        'Freezes a rival team''s timer for 30 seconds.',                              'offensive', 5, 'public',  'team',       '{"duration_seconds": 30}',           10),
  ('time_drain',   'Time Drain',    'Siphons 15 seconds from a rival team''s clock.',                             'offensive', 5, 'public',  'team',       '{"seconds_to_remove": 15}',          20),
  ('tap_to_break', 'Tap to Break',  'Locks a rival team until all members tap the screen 20 times.',              'offensive', 8, 'public',  'team',       '{"taps_required": 20}',              30),
  ('time_boost',   'Time Boost',    'Adds 30 extra seconds to your own timer.',                                   'defensive', 3, 'silent',  'self',       '{"seconds_to_add": 30}',             40),
  ('shield',       'Shield',        'Blocks the next offensive powerup used against your team.',                  'defensive', 5, 'silent',  'self',       '{}',                                 50),
  ('double_down',  'Double Down',   'Doubles your score for the current challenge.',                              'defensive', 5, 'silent',  'self',       '{"multiplier": 2}',                  60),
  ('lifeline',     'Lifeline',      'Allows your team to re-submit an answer once.',                              'defensive', 5, 'silent',  'self',       '{}',                                 70),
  ('give_shot',    'Give a Shot',   'Forces a rival team to take a mystery shot — host unlocks the forfeit.',     'social',    3, 'public',  'team',       '{"requires_host_unlock": true}',     80),
  ('bonus_points', 'Bonus Points',  'Instantly adds 10 bonus points to your team score.',                        'self',      3, 'silent',  'self',       '{"points": 10}',                     90),
  ('lucky_dice',   'Lucky Dice',    'Rolls a die (1–6) and multiplies your next challenge score by the result.', 'self',      3, 'silent',  'self',       '{"min": 1, "max": 6}',              100)
ON CONFLICT (slug) DO NOTHING;

-- 7) RLS policies

-- powerups: anon SELECT
DO $$ BEGIN
  ALTER TABLE powerups ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "anon_select_powerups" ON powerups FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- set_powerups: anon SELECT
DO $$ BEGIN
  ALTER TABLE set_powerups ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "anon_select_set_powerups" ON set_powerups FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- powerup_usages: anon SELECT only
DO $$ BEGIN
  ALTER TABLE powerup_usages ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "anon_select_powerup_usages" ON powerup_usages FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 8) Realtime publications
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE powerup_usages;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE teams;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE game_sets;
EXCEPTION WHEN others THEN null; END $$;
