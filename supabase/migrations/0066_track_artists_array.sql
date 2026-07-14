-- 0066_track_artists_array.sql
--
-- T1 — tracks redesign, blocker piece 1/3 (tracks → challenges → sets). Adds a
-- multi-artist list alongside the existing scalar `artist` column. Copies the
-- accepted_titles pattern (0007_accepted_titles.sql) exactly: an array column
-- beside the scalar, with array-if-present-else-scalar fallback at READ time —
-- that fallback is scoring's job (C1, not built here).
--
-- `artist` remains the list-display value: the app writes
-- artist = artists.join(' & ') whenever artists[] is edited via the new tag
-- editor on /admin/tracks, so every existing read site (submit pipeline,
-- player load, tracks list, computeSetMaxScore, fixtures, bots) keeps working
-- with zero query change — none of them read `artists` yet.
--
-- No backfill: artists defaults to '{}'. A track only gets a real list once
-- the host opens it and edits via the tag input; the editor seeds the input
-- from [artist] on first open. Every untouched track is byte-identical to
-- before this migration until then.
--
-- Numbering note: 0064/0065 are earmarked for two other in-flight features
-- (Double Down / Lucky Dice powerups) not yet merged as of this migration, so
-- this one is numbered 0066 to avoid a collision — renumber at merge time if
-- 0064/0065 land first and this is still pending.
--
-- Run manually in Supabase SQL Editor.

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS artists text[] NOT NULL DEFAULT '{}';
