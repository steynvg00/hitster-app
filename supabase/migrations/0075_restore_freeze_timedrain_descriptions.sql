-- 0075_restore_freeze_timedrain_descriptions.sql
--
-- Restores powerup_types.description for freeze and time_drain. Migration
-- 0059 (freeze_time_drain_live) already carried the correct descriptions
-- (lines 30 and 44), but the SQL Editor run that flipped these two rows live
-- predates the finished description text — the DB still holds a literal
-- "..." placeholder for both, which is why the admin powerup-config panel
-- renders "..." instead of a description for these two types. Every other
-- field 0059 set (coming_soon, enabled_by_default, category, name, icon,
-- thresholds) already matches — only description drifted.
--
-- Idempotent: re-running sets the same two strings again, no-op on a DB
-- that's already correct. Touches only these two rows, only the description
-- column.
--
-- Run manually in Supabase SQL Editor.

UPDATE powerup_types
  SET description = 'Target another team — freezes their challenge timer for 30 seconds and blocks their input. Blocked by Shield.'
  WHERE id = 'freeze';

UPDATE powerup_types
  SET description = 'Target another team — drains 15 seconds from their challenge timer. Blocked by Shield.'
  WHERE id = 'time_drain';
