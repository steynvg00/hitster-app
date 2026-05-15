-- Migration 0041: effect_presets table
-- Run manually in Supabase SQL Editor. Do NOT execute via CLI.
-- NOTE: The 'effects' variant CHECK constraint and variant_defaults row were
-- already applied by migration 0037 (from feature/challenge-types-redesign).

CREATE TABLE IF NOT EXISTS effect_presets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  effects     jsonb NOT NULL DEFAULT '{}',
  is_builtin  boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE effect_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "effect_presets_select" ON effect_presets
  FOR SELECT USING (true);

CREATE POLICY "effect_presets_insert" ON effect_presets
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "effect_presets_delete" ON effect_presets
  FOR DELETE USING (auth.uid() = created_by AND is_builtin = false);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE effect_presets;
EXCEPTION WHEN others THEN null;
END $$;
