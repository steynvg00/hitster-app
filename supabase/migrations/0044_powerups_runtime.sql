-- Migration 0044: powerups runtime
-- New tables: powerup_types (catalog), team_powerups (earned), team_effects (active effects shell)
-- New game_sets columns: crown_holder_team_id, hard_gaan_window_minutes

CREATE TABLE IF NOT EXISTS powerup_types (
    id text PRIMARY KEY,
    name text NOT NULL,
    category text NOT NULL CHECK (category IN ('defensive', 'self', 'information', 'offensive', 'social', 'punishment', 'wildcard')),
    description text,
    immediate_use boolean NOT NULL DEFAULT false,
    holdable boolean NOT NULL DEFAULT true,
    default_min_score_pct int DEFAULT 0 CHECK (default_min_score_pct BETWEEN 0 AND 100),
    default_max_score_pct int DEFAULT 100 CHECK (default_max_score_pct BETWEEN 0 AND 100),
    sort_order int DEFAULT 0,
    icon text,
    enabled_by_default boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_powerups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    set_id uuid REFERENCES game_sets(id) ON DELETE CASCADE,
    powerup_type_id text NOT NULL REFERENCES powerup_types(id),
    granted_at timestamptz DEFAULT now(),
    granted_from_challenge_id uuid REFERENCES challenges(id),
    used_at timestamptz,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'held', 'used', 'lost')),
    payload jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS team_powerups_held_idx ON team_powerups(team_id, set_id) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS team_powerups_pending_idx ON team_powerups(team_id, granted_at DESC) WHERE status = 'pending';

-- Reserve schema for P3b/P3c without using it yet
CREATE TABLE IF NOT EXISTS team_effects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    set_id uuid REFERENCES game_sets(id) ON DELETE CASCADE,
    effect_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    activated_at timestamptz DEFAULT now(),
    expires_at timestamptz,
    consumed_at timestamptz,
    consumed_challenge_id uuid REFERENCES challenges(id)
);

CREATE INDEX IF NOT EXISTS team_effects_active_idx ON team_effects(team_id, effect_type) WHERE consumed_at IS NULL;

DO $$ BEGIN
    ALTER TABLE game_sets ADD COLUMN IF NOT EXISTS crown_holder_team_id uuid REFERENCES teams(id);
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE game_sets ADD COLUMN IF NOT EXISTS hard_gaan_window_minutes int DEFAULT 15;
EXCEPTION WHEN others THEN null; END $$;

-- RLS
ALTER TABLE powerup_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_powerups ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_effects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Anon read powerup_types" ON powerup_types FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Anon read team_powerups" ON team_powerups FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Anon read team_effects" ON team_effects FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Realtime
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE team_powerups;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE team_effects;
EXCEPTION WHEN others THEN null; END $$;

-- Seed 7 powerup types
INSERT INTO powerup_types (id, name, category, description, immediate_use, holdable, default_min_score_pct, icon, sort_order) VALUES
('shield',              'Shield',                   'defensive',    'Blocks one offensive attack on your team.',                                                              false, true,  60,  '🛡️', 10),
('time_boost',          'Time Boost',               'defensive',    '+30 seconds on your next challenge timer.',                                                              false, true,  50,  '⏱️', 20),
('insurance',           'Insurance',                'defensive',    'If you score 0 on your next challenge, retroactively get 50% of max possible.',                         false, true,  70,  '🪙', 30),
('bonus_points',        'Bonus Points',             'self',         '+5 points to your team immediately.',                                                                    true,  false, 50,  '✨', 40),
('hard_gaan',           'Hard Gaan',                'self',         'x1.3 multiplier on challenge points for the next 15 minutes.',                                           true,  false, 70,  '🔥', 50),
('single_event_mult',   'Single-Event Multiplier',  'self',         'Random multiplier (x1.2/x1.4/x1.6) applied to your next challenge.',                                    true,  false, 70,  '🎲', 60),
('free_answer',         'Free Answer',              'information',  'Reveals the correct value for one randomly-chosen field on your next challenge.',                        false, true,  80,  '💡', 70)
ON CONFLICT (id) DO NOTHING;
