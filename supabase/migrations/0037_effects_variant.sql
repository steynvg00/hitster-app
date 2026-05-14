-- Widen challenges + variant_defaults CHECK constraints to include 'effects'
DO $$ BEGIN
    ALTER TABLE challenges DROP CONSTRAINT challenges_variant_check;
EXCEPTION WHEN others THEN null; END $$;

ALTER TABLE challenges
    ADD CONSTRAINT challenges_variant_check
    CHECK (variant IN ('standard','anthem','label','mashup','fragments','effects'));

DO $$ BEGIN
    ALTER TABLE variant_defaults DROP CONSTRAINT variant_defaults_variant_check;
EXCEPTION WHEN others THEN null; END $$;

ALTER TABLE variant_defaults
    ADD CONSTRAINT variant_defaults_variant_check
    CHECK (variant IN ('standard','anthem','label','mashup','fragments','effects'));

-- Per-tab effects JSONB column
ALTER TABLE challenge_tabs ADD COLUMN IF NOT EXISTS effects jsonb NULL;

-- Seed variant_defaults for effects
INSERT INTO variant_defaults (variant, points_config)
VALUES ('effects', '{"field_points":{"artist":10,"title":10,"year":10}}'::jsonb)
ON CONFLICT (variant) DO NOTHING;
