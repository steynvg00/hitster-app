-- 0024_ownership.sql
-- Add created_by (references auth.users) to all host-managed tables.
-- Column is nullable so existing rows are unaffected until backfill.
-- RLS policies are NOT restricted by created_by yet — that is a future feature.

ALTER TABLE game_sets      ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
ALTER TABLE challenges     ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
ALTER TABLE tracks         ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
ALTER TABLE clips          ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
ALTER TABLE answer_options ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
ALTER TABLE nfc_tags       ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
ALTER TABLE set_challenges ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
ALTER TABLE challenge_tracks ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

-- ─── BACKFILL ────────────────────────────────────────────────────────────────
-- Run this block AFTER you have signed in once via Supabase Auth.
-- It assigns all existing rows to the first user in auth.users.
--
-- DO $$
-- DECLARE first_user_id uuid;
-- BEGIN
--   SELECT id INTO first_user_id FROM auth.users ORDER BY created_at LIMIT 1;
--   IF first_user_id IS NOT NULL THEN
--     UPDATE game_sets       SET created_by = first_user_id WHERE created_by IS NULL;
--     UPDATE challenges      SET created_by = first_user_id WHERE created_by IS NULL;
--     UPDATE tracks          SET created_by = first_user_id WHERE created_by IS NULL;
--     UPDATE clips           SET created_by = first_user_id WHERE created_by IS NULL;
--     UPDATE answer_options  SET created_by = first_user_id WHERE created_by IS NULL;
--     UPDATE nfc_tags        SET created_by = first_user_id WHERE created_by IS NULL;
--     UPDATE set_challenges  SET created_by = first_user_id WHERE created_by IS NULL;
--     UPDATE challenge_tracks SET created_by = first_user_id WHERE created_by IS NULL;
--   END IF;
-- END $$;
