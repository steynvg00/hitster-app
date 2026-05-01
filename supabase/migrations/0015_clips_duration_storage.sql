-- =============================================================================
-- Hitster — Session 8a: audio upload UI
-- Adds duration and storage_object_path to clips.
-- duration: parsed seconds from HTML5 Audio API, null for manual-URL clips.
-- storage_object_path: the key within the 'audio' bucket, null for manual URLs.
-- =============================================================================

ALTER TABLE clips
  ADD COLUMN IF NOT EXISTS duration float,
  ADD COLUMN IF NOT EXISTS storage_object_path text;
