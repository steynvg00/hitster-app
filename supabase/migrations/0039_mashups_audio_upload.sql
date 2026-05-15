-- Replace primary_clip_id with a direct audio file upload on mashups.
-- A mashup is its own blended audio file, not a reference to an existing clip.
-- Source tracks remain in mashup_sources for naming/scoring purposes only.

ALTER TABLE mashups DROP COLUMN primary_clip_id;
ALTER TABLE mashups ADD COLUMN audio_storage_path text NOT NULL DEFAULT '';
ALTER TABLE mashups ADD COLUMN audio_duration_seconds float NULL;

-- Wipe test data — user confirmed wipe acceptable before running this migration.
DELETE FROM mashups;

-- Now that the table is empty, remove the DEFAULT so new rows must supply the path explicitly.
ALTER TABLE mashups ALTER COLUMN audio_storage_path DROP DEFAULT;
