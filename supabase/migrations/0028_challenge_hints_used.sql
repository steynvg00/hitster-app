-- 0028_challenge_hints_used.sql
-- Tracks which teams have already revealed the hint for a challenge.
-- Used by the NFC hint scan flow to gate repeat hint views and
-- optionally penalise point totals on the challenge page.
--
-- Run manually in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS challenge_hints_used (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid        NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  team_id      uuid        NOT NULL REFERENCES teams(id)      ON DELETE CASCADE,
  used_at      timestamptz NOT NULL DEFAULT now()
);

-- Enforce one hint-reveal per team per challenge
CREATE UNIQUE INDEX IF NOT EXISTS challenge_hints_used_team_challenge
  ON challenge_hints_used (challenge_id, team_id);

-- RLS: any authenticated player can record + read their own hint usage
ALTER TABLE challenge_hints_used ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read hint usage"
  ON challenge_hints_used FOR SELECT USING (true);

CREATE POLICY "anon insert hint usage"
  ON challenge_hints_used FOR INSERT WITH CHECK (true);

-- Add to realtime publication so challenge page can react to hint reveals
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE challenge_hints_used;
EXCEPTION WHEN others THEN null;
END $$;
