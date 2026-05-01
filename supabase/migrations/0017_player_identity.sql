-- =============================================================================
-- Hitster — Session 8b: player identity
-- Extends players table for solo/team onboarding, adds player_photos bucket.
-- =============================================================================

-- Make team_id nullable so solo players can exist without a team association
ALTER TABLE players ALTER COLUMN team_id DROP NOT NULL;

-- New columns
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS photo_url    text,
  ADD COLUMN IF NOT EXISTS session_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'team'
    CHECK (mode IN ('team', 'solo_group', 'solo_private')),
  ADD COLUMN IF NOT EXISTS session_expires_at timestamptz;

-- Backfill display_name from team color for existing rows
UPDATE players p
  SET display_name = t.color
  FROM teams t
  WHERE t.id = p.team_id
  AND p.display_name IS NULL;

-- Safe fallback in case any row still lacks a display_name
UPDATE players SET display_name = name WHERE display_name IS NULL;

ALTER TABLE players ALTER COLUMN display_name SET NOT NULL;

-- player_photos bucket (public, 5 MB limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'player_photos',
  'player_photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880;

DO $$ BEGIN
  CREATE POLICY "Public player photo read" ON storage.objects
    FOR SELECT USING (bucket_id = 'player_photos');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
