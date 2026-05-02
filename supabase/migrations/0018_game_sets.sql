-- ─── game_sets ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  team_count int NOT NULL DEFAULT 6,
  total_timer_seconds int,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE game_sets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "anon_select_game_sets" ON game_sets FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── set_challenges ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS set_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES game_sets(id) ON DELETE CASCADE,
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  UNIQUE (set_id, challenge_id)
);

ALTER TABLE set_challenges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "anon_select_set_challenges" ON set_challenges FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Extend players ──────────────────────────────────────────────────────────
ALTER TABLE players ADD COLUMN IF NOT EXISTS set_id uuid REFERENCES game_sets(id) ON DELETE SET NULL;

-- Allow anon to read players (needed for realtime lobby view)
DO $$ BEGIN
  CREATE POLICY "anon_select_players" ON players FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Extend nfc_tags ─────────────────────────────────────────────────────────
ALTER TABLE nfc_tags ADD COLUMN IF NOT EXISTS set_id uuid REFERENCES game_sets(id) ON DELETE SET NULL;

-- Expand purpose constraint to include randomizer
ALTER TABLE nfc_tags DROP CONSTRAINT IF EXISTS nfc_tags_purpose_check;
ALTER TABLE nfc_tags ADD CONSTRAINT nfc_tags_purpose_check
  CHECK (purpose IN ('team_identity', 'team_entry', 'challenge', 'randomizer'));

-- ─── Realtime publications ───────────────────────────────────────────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE game_sets;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE set_challenges;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE players;
EXCEPTION WHEN others THEN null; END $$;
