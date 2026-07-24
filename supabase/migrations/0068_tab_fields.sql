-- 0068_tab_fields.sql
--
-- C3b — per-tab velden. Adds a nullable `fields` JSONB column to challenge_tabs
-- so a single tab can OVERRIDE the challenge-wide field set (which fields exist,
-- their input mode, max points, bonus flag) for just that tab.
--
-- Deliberately the SAME row shape as points_config.fields[]:
--   { name, input_mode, max_points, is_bonus }
-- so the existing parser (resolveChallengeFields' per-row logic) and C3c's
-- saveFields validation are reusable without a second shape concept.
--
-- Semantics (enforced in code, not here — see resolveTabFields in
-- src/lib/server/scoring.ts):
--   NULL           → inherit the challenge-wide fields (current behaviour, exact)
--   non-empty array → override the fields for THIS tab only
--   [] / malformed  → inherit (safest fallback; no override)
--
-- NO BACKFILL. Every existing row stays NULL, so everything that works today
-- keeps working bit-identically until C3c writes the first override. There is
-- no app path to set this column in this batch (C3b) — the admin FieldsEditor
-- lands in C3c.
--
-- CHECK: fields must be NULL or a JSON array. This blocks gross malformation
-- (an object/string/number stored where an array belongs) WITHOUT touching any
-- valid value:
--   - NULL passes (the default state of every row).
--   - [] passes (an empty array — treated as "inherit" in code).
--   - Any array of rows passes.
-- Per-element validation (each element an object with the four keys) is
-- deliberately NOT enforced here: resolveTabFields already tolerates malformed
-- or under-specified elements (skips unknown names, falls back per key), so a
-- stricter CHECK would reject values the resolver handles gracefully. C3c's
-- saveFields will validate shape at write time instead.
--
-- Run manually in Supabase SQL Editor.

ALTER TABLE challenge_tabs
  ADD COLUMN IF NOT EXISTS fields jsonb NULL;

DO $$
BEGIN
  ALTER TABLE challenge_tabs
    ADD CONSTRAINT challenge_tabs_fields_is_array
    CHECK (fields IS NULL OR jsonb_typeof(fields) = 'array');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
