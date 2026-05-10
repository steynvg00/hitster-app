-- Migration 0029: lobby polish
-- Adds tutorial text, NFC lock, randomizer toggle, challenge_unlocks, last_results

-- Per-variant tutorial text
ALTER TABLE variant_defaults ADD COLUMN IF NOT EXISTS tutorial_text TEXT;

-- NFC lock toggle per game set
ALTER TABLE game_sets ADD COLUMN IF NOT EXISTS nfc_lock_enabled BOOLEAN DEFAULT false;

-- Randomizer card toggle per set
ALTER TABLE game_sets ADD COLUMN IF NOT EXISTS randomizer_enabled BOOLEAN DEFAULT false;

-- Last results snapshot (saved on resetGame)
ALTER TABLE game_sets ADD COLUMN IF NOT EXISTS last_results JSONB;

-- Track which (challenge, team) pairs have been NFC-unlocked
CREATE TABLE IF NOT EXISTS challenge_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  set_id UUID REFERENCES game_sets(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(challenge_id, team_id, set_id)
);
ALTER TABLE challenge_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon select unlocks" ON challenge_unlocks FOR SELECT TO anon USING (true);
CREATE POLICY "anon insert unlocks" ON challenge_unlocks FOR INSERT TO anon WITH CHECK (true);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE challenge_unlocks;
EXCEPTION WHEN others THEN null; END $$;

-- Add challenge_unlock to nfc_tags purpose check if possible (best-effort)
-- Note: if the check constraint is named, alter it; otherwise skip
DO $$ BEGIN
  -- attempt to update the check constraint on nfc_tags.purpose to include challenge_unlock
  -- If constraint doesn't exist or already includes it, do nothing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nfc_tags' AND column_name = 'purpose'
  ) THEN
    RAISE NOTICE 'nfc_tags.purpose column not found, skipping';
  END IF;
END $$;

-- Seed placeholder tutorial text for all 8 variants
UPDATE variant_defaults SET tutorial_text = 'Listen to the track. Guess the artist, the song title, and the year it came out. Score points for each correct field.'
WHERE variant = 'normal' AND (tutorial_text IS NULL OR tutorial_text = '');

UPDATE variant_defaults SET tutorial_text = 'A hardstyle track is playing. Identify the record label that released it, plus the artist, title, and year. Labels can be tricky — listen for clues in the production style.'
WHERE variant = 'label' AND (tutorial_text IS NULL OR tutorial_text = '');

UPDATE variant_defaults SET tutorial_text = 'This track was an anthem at a major festival. Name the festival, then identify the artist, title, and year. Think about which events it could have headlined.'
WHERE variant = 'anthem' AND (tutorial_text IS NULL OR tutorial_text = '');

UPDATE variant_defaults SET tutorial_text = 'A vocal snippet is playing. Identify the vocal source (the singer or vocal sample), the artist who made the track, and the year. Focus on the voice — it''s your biggest clue.'
WHERE variant = 'vocal' AND (tutorial_text IS NULL OR tutorial_text = '');

UPDATE variant_defaults SET tutorial_text = 'You''ll hear a short sound fragment from a track. Identify the song title and the artist from that brief clip alone. No extra hints — just your ears.'
WHERE variant = 'fragments' AND (tutorial_text IS NULL OR tutorial_text = '');

UPDATE variant_defaults SET tutorial_text = 'Pure kick drum — no melody, no vocals. Just the punch. Identify the artist who made this track from the kick drum pattern alone. Good luck.'
WHERE variant = 'kick' AND (tutorial_text IS NULL OR tutorial_text = '');

UPDATE variant_defaults SET tutorial_text = 'Two or more tracks mashed together. Identify the song title and the artists behind the mashup. You might hear multiple melodies layered at once — stay sharp.'
WHERE variant = 'mashup' AND (tutorial_text IS NULL OR tutorial_text = '');

UPDATE variant_defaults SET tutorial_text = 'Head-to-head. Both teams hear the same track and race to name the artist, title, and year. First to submit wins the round — speed and accuracy both count.'
WHERE variant = 'battle' AND (tutorial_text IS NULL OR tutorial_text = '');
