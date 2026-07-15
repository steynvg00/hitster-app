-- PLACEHOLDER NUMBER — confirm against Supabase (latest applied migration) before running.
-- Highest number in this repo's migrations/ folder at the time this was written was 0066
-- (0067 assumed next), but the source of truth is whatever's actually been applied to the
-- live project — check there before renaming/running this file.
--
-- C5: clip_type was removed entirely from the code layer (upload endpoint, all UI read
-- sites, TrimModal/tracks-page pickers, database.ts/types/index.ts row types) in this
-- same change. No code reads or writes clips.type any more. This migration is NOT run by
-- Claude — Steyn runs it manually after merge, once the number above is confirmed correct.

ALTER TABLE clips DROP COLUMN IF EXISTS type;
