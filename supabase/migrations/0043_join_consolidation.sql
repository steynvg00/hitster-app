-- Migration 0043: join consolidation + team selection mode
-- URL-only join: /sets/[id]/join is the single canonical entry point.
-- Hosts encode this URL onto NFC tags using external NFC writers — the app
-- no longer manages "randomizer cards" as a concept.

-- 1. Drop obsolete team_assignment_mode column (added in 0042, superseded)
ALTER TABLE game_sets DROP COLUMN IF EXISTS team_assignment_mode;

-- 2. Add team_selection_mode (random | selectable)
ALTER TABLE game_sets ADD COLUMN IF NOT EXISTS team_selection_mode text NOT NULL DEFAULT 'random'
    CHECK (team_selection_mode IN ('random', 'selectable'));

-- 3. Drop randomizer_enabled (from 0029, obsolete with URL-only join)
ALTER TABLE game_sets DROP COLUMN IF EXISTS randomizer_enabled;

-- 4. Delete all randomizer-purpose NFC tags
DELETE FROM nfc_tags WHERE purpose = 'randomizer';

-- 5. Update CHECK constraint on nfc_tags.purpose to remove 'randomizer'
ALTER TABLE nfc_tags DROP CONSTRAINT IF EXISTS nfc_tags_purpose_check;
ALTER TABLE nfc_tags ADD CONSTRAINT nfc_tags_purpose_check
    CHECK (purpose IN ('team_identity', 'team_entry', 'challenge', 'hint', 'challenge_unlock'));
