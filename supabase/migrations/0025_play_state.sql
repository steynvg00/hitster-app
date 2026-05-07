-- 0025_play_state.sql
-- Add play_state lifecycle column to game_sets.
-- Values: joining (accepting players) | playing (game in progress) | recap (podium reveal)
--
-- Run manually in Supabase SQL Editor.

ALTER TABLE game_sets
  ADD COLUMN IF NOT EXISTS play_state text NOT NULL DEFAULT 'joining'
  CONSTRAINT game_sets_play_state_check CHECK (play_state IN ('joining', 'playing', 'recap'));

-- Backfill: active sets are assumed mid-game; inactive sets default to joining already.
UPDATE game_sets SET play_state = 'playing' WHERE status = 'active';
