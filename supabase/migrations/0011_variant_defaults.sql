-- =============================================================================
-- Hitster — Session 7: variant defaults
-- Tier-1 point values editable by the host at /admin/variant-defaults.
-- Seeded to match the hardcoded DEFAULT_FIELD_MAX in scoring.ts so the
-- admin UI shows sensible starting values.
-- Challenge load merges: challenge.points_config > variant_defaults > hardcoded fallback
-- =============================================================================

CREATE TABLE variant_defaults (
  variant       text    PRIMARY KEY
    CHECK (variant IN ('normal','label','anthem','vocal','fragments','kick','mashup','battle')),
  points_config jsonb   NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO variant_defaults (variant, points_config) VALUES
  ('normal',    '{"field_points": {"artist": 5, "title": 5, "year": 10}}'),
  ('label',     '{"field_points": {"label": 5, "artist": 5, "title": 5, "year": 10}}'),
  ('anthem',    '{"field_points": {"festival": 5, "artist": 5, "title": 5, "year": 10}}'),
  ('vocal',     '{"field_points": {"vocal_source": 5, "artist": 5, "year": 10}}'),
  ('fragments', '{"field_points": {"title": 5, "artist": 5}}'),
  ('kick',      '{"field_points": {"artist": 5}}'),
  ('mashup',    '{"field_points": {"artist": 5, "title": 5}}'),
  ('battle',    '{"field_points": {"artist": 5, "title": 5, "year": 10}}');

ALTER TABLE variant_defaults ENABLE ROW LEVEL SECURITY;

-- Admin UI reads this via the browser client on the variant-defaults page
CREATE POLICY "public read variant_defaults" ON variant_defaults
  FOR SELECT USING (true);

-- Writes go through createAdminClient() (service role, bypasses RLS)

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE variant_defaults;
EXCEPTION WHEN others THEN null;
END $$;
