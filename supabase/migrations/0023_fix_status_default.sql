-- Fix column default: migration 0021 changed the CHECK constraint to ('active', 'inactive')
-- but did not update the column default, leaving it as 'draft' which violates the constraint.
ALTER TABLE game_sets ALTER COLUMN status SET DEFAULT 'inactive';
