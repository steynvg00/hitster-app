-- Migration 0030: fix nfc_tags.purpose CHECK constraint
-- Adds 'challenge_unlock' which was added to TypeScript types in 0029 but not to the DB constraint.
--
-- Before running: verify existing constraint with:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'nfc_tags_purpose_check';
--
-- Include all known purposes so no existing rows are invalidated.

ALTER TABLE nfc_tags DROP CONSTRAINT IF EXISTS nfc_tags_purpose_check;

ALTER TABLE nfc_tags
  ADD CONSTRAINT nfc_tags_purpose_check
  CHECK (purpose IN (
    'team_identity',
    'team_entry',
    'challenge',
    'randomizer',
    'hint',
    'challenge_unlock'
  ));
