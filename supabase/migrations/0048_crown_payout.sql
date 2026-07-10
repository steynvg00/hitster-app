-- Track whether the end-game crown payout (+2) has already been applied for a set
ALTER TABLE game_sets
  ADD COLUMN IF NOT EXISTS crown_payout_applied boolean NOT NULL DEFAULT false;
