-- 0076_hard_gaan_multiplier_text.sql
--
-- Corrects powerup_types.description for hard_gaan: the card claims x1.3, the
-- code applies x1.5.
--
-- src/lib/server/powerups.ts, the hard_gaan activation branch, writes
-- payload {multiplier: 1.5, window_minutes} — and 1.5 is the multiplier the
-- scorer actually folds into the additive-delta sum. The description seeded in
-- 0044_powerups_runtime.sql (line 90) has said "x1.3" since day one, so the
-- card has always under-promised what the powerup does.
--
-- The CODE is right here and stays untouched: x1.5 is the value the balance of
-- the powerup set was tuned around (single_event_mult rolls x1.2/x1.4/x1.6 for
-- one submission; hard_gaan's x1.5 buys a 15-minute window). Only the text
-- moves.
--
-- The 15 minutes in the text is the DEFAULT — game_sets.hard_gaan_window_minutes
-- (added in 0044) can override it per set. Left as-is: it was already the wording
-- before this migration and is not the mismatch being fixed.
--
-- Verbatim before:
--   'x1.3 multiplier on challenge points for the next 15 minutes.'
-- Verbatim after (only the multiplier number differs):
--   'x1.5 multiplier on challenge points for the next 15 minutes.'
--
-- Idempotent: re-running sets the same string again, no-op on a DB that is
-- already correct. Touches one row, one column.
--
-- Run manually in Supabase SQL Editor.

UPDATE powerup_types
  SET description = 'x1.5 multiplier on challenge points for the next 15 minutes.'
  WHERE id = 'hard_gaan';
