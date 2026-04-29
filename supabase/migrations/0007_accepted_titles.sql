-- =============================================================================
-- Hitster — Session 6: accepted_titles on tracks
-- Allows hosts to register alternate spellings/phrasings for track titles
-- so open-text submissions are fuzzy-matched against all accepted forms.
-- =============================================================================

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS accepted_titles text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Populate: default to the canonical title for all existing tracks
UPDATE tracks SET accepted_titles = ARRAY[title] WHERE accepted_titles = ARRAY[]::text[];
