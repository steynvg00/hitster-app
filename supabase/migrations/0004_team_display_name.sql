-- Add editable display_name to teams; defaults to the existing label value.
-- After running, teams keep their current label as display_name.
-- Admins can then edit display_name via /admin/teams without touching label.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS display_name TEXT;

UPDATE teams
  SET display_name = label
  WHERE display_name IS NULL;

ALTER TABLE teams
  ALTER COLUMN display_name SET NOT NULL;
