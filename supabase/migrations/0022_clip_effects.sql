-- Add effects JSONB to clips for pitch/tempo adjustments at playback time.
-- Schema: { "pitch": 0, "tempo": 1.0 }  (no-op defaults)
ALTER TABLE clips ADD COLUMN IF NOT EXISTS effects jsonb NOT NULL DEFAULT '{}';
