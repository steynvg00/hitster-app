-- Add admin-facing columns to challenges and tracks

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS stage_label TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS points_config JSONB NOT NULL DEFAULT '{}';

-- Sync status with existing is_active flag
UPDATE challenges SET status = 'active' WHERE is_active = true;
UPDATE challenges SET status = 'draft'  WHERE is_active = false OR is_active IS NULL;

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS genre TEXT,
  ADD COLUMN IF NOT EXISTS subgenre TEXT;
