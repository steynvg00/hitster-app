-- 0062_powerups_default_enabled.sql
--
-- Reverses a deliberate design choice from the offensive/social/punishment go-live
-- migrations (0057 penalty_shot, 0058 give_a_shot, 0059 freeze + time_drain, 0060
-- tap_to_break): each explicitly set enabled_by_default = false and documented it
-- inline as "opt-in: a host enables it per set from the console". The host now
-- wants offensive/social/punishment enabled BY DEFAULT, so teams can earn them
-- without a per-set manual toggle.
--
-- enabled_by_default gates both the console's effective_enabled display
-- (src/routes/admin/sets/[id]/+page.server.ts) AND actual earning eligibility
-- (planAwards' `ov?.enabled ?? t.enabled_by_default` checks, src/lib/server/
-- powerups.ts) — flipping this column alone makes all five types earnable by
-- default, no code change needed; both read sites already fall through to it.
--
-- Affects new AND existing sets: neither set-creation path
-- (src/routes/admin/sets/+page.server.ts) seeds powerup_config.types, so any set
-- — new or already created — that hasn't had one of these five types manually
-- toggled in the console has no stored per-set override and picks up this
-- default live. No data migration needed for existing sets. A set where a host
-- has explicitly disabled one of these types keeps that explicit override
-- (as designed) and would need a manual re-toggle, not this migration.
--
-- Idempotent by nature (a plain column SET, no INSERT).
--
-- Run manually in Supabase SQL Editor.

UPDATE powerup_types
  SET enabled_by_default = true
  WHERE id IN ('give_a_shot', 'freeze', 'time_drain', 'tap_to_break', 'penalty_shot');
