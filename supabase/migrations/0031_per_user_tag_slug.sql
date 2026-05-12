-- Migration 0031: per-user NFC tag slug uniqueness
-- The nfc_tags table used id (TEXT PK) as the slug that appears in NFC URLs.
-- This migration separates the concepts: id becomes a UUID internal PK, slug
-- becomes the URL component with a per-user unique constraint.
--
-- Existing rows: slug is backfilled from old id values, so all existing slugs
-- are already globally unique — no (slug, created_by) conflicts can arise.
-- Existing NFC chips still work: /nfc/<slug> now resolves via the slug column.
--
-- Constraint being replaced: nfc_tags_pkey (the global TEXT PK on id).

-- Step 1: add slug column and backfill from current text id
DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN IF NOT EXISTS slug TEXT;
EXCEPTION WHEN others THEN null; END $$;

UPDATE nfc_tags SET slug = id WHERE slug IS NULL;

ALTER TABLE nfc_tags ALTER COLUMN slug SET NOT NULL;

-- Step 2: add the new UUID primary key column
DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN IF NOT EXISTS _new_id UUID DEFAULT gen_random_uuid() NOT NULL;
EXCEPTION WHEN others THEN null; END $$;

-- Step 3: drop old text PK (nfc_tags_pkey) and promote _new_id to PK
DO $$ BEGIN
  ALTER TABLE nfc_tags DROP CONSTRAINT nfc_tags_pkey;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE nfc_tags ADD PRIMARY KEY (_new_id);
EXCEPTION WHEN others THEN null; END $$;

-- Step 4: drop old text id column (now redundant — values live in slug)
DO $$ BEGIN
  ALTER TABLE nfc_tags DROP COLUMN id;
EXCEPTION WHEN others THEN null; END $$;

-- Step 5: rename _new_id → id
DO $$ BEGIN
  ALTER TABLE nfc_tags RENAME COLUMN _new_id TO id;
EXCEPTION WHEN others THEN null; END $$;

-- Step 6: per-user unique constraint on (slug, created_by)
DO $$ BEGIN
  ALTER TABLE nfc_tags ADD CONSTRAINT nfc_tags_slug_user_unique UNIQUE (slug, created_by);
EXCEPTION WHEN others THEN null; END $$;
