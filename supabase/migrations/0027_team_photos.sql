-- 0027_team_photos.sql
-- Adds photo_url column to teams for team avatar uploads.
-- Storage bucket "team-photos" must be created manually in Supabase Dashboard
-- (Storage → New bucket → "team-photos", public read).
--
-- Run manually in Supabase SQL Editor.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS photo_url text;
