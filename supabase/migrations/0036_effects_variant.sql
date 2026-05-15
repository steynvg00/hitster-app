-- Migration 0036: Effects variant + effect_presets table
-- Run manually in Supabase SQL Editor. Do NOT execute via CLI.

-- Add 'effects' to the variant CHECK constraint on challenges
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_variant_check;
ALTER TABLE challenges ADD CONSTRAINT challenges_variant_check
  CHECK (variant IN ('normal','label','anthem','vocal','fragments','kick','mashup','battle','effects'));

-- Add 'effects' to the variant CHECK constraint on variant_defaults
ALTER TABLE variant_defaults DROP CONSTRAINT IF EXISTS variant_defaults_variant_check;
ALTER TABLE variant_defaults ADD CONSTRAINT variant_defaults_variant_check
  CHECK (variant IN ('normal','label','anthem','vocal','fragments','kick','mashup','battle','effects'));

-- Insert default variant_defaults row for effects
INSERT INTO variant_defaults (variant, points_config, streak_config, tutorial_text)
VALUES (
  'effects',
  '{"field_points": {"artist": 3, "title": 3, "year": 3}}',
  '{"thresholds": []}',
  'Some audio effects have been applied to make this track harder to recognize. Listen carefully and guess the original artist, title, and year.'
)
ON CONFLICT (variant) DO NOTHING;

-- effect_presets table: user-saved and built-in presets
CREATE TABLE IF NOT EXISTS effect_presets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  effects     jsonb NOT NULL DEFAULT '{}',
  is_builtin  boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS: readable by everyone authenticated, writable only by creator
ALTER TABLE effect_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "effect_presets_select" ON effect_presets
  FOR SELECT USING (true);

CREATE POLICY "effect_presets_insert" ON effect_presets
  FOR INSERT WITH CHECK (auth.uid() = created_by OR is_builtin = false);

CREATE POLICY "effect_presets_delete" ON effect_presets
  FOR DELETE USING (auth.uid() = created_by AND is_builtin = false);
