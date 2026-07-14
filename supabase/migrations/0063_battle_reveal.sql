-- 0063_battle_reveal.sql
--
-- Battle Mode stuk 3b: the reveal-phase machinery. Battles resolve at startRecap
-- (stuk 3a's barrier), so by the time recap runs every battle-with-submissions
-- has a populated set_challenges.battle_ranking; zero-submission battles keep it
-- NULL and are excluded from the reveal.
--
-- Two changes:
--
-- 1. game_sets.battle_reveal_index — "number of battles revealed", a SEPARATE
--    counter from recap_reveal_index. recap_reveal_index is "number of TEAMS
--    revealed" and is read as a direct index into recap_ranking in six places
--    across three surfaces (host recap, TV podium, player waiting). The battle
--    reveal must never consume or perturb it, hence its own column rather than
--    an overloaded offset.
--
-- 2. recap_state CHECK widened with 'battle_reveal'. Was (0020_recap_state.sql):
--    CHECK (recap_state IN ('pending', 'revealing', 'complete'))
--    Now:  CHECK (recap_state IN ('pending', 'battle_reveal', 'revealing', 'complete'))
--    New phase order: pending → battle_reveal → revealing → complete.
--    ('complete' already existed but was never written by any code path until
--    this stuk — see the recap reveal action.)
--
-- Run manually in Supabase SQL Editor.

-- 1) The battle reveal counter. Plain additive column, idempotent via IF NOT EXISTS.
ALTER TABLE game_sets
  ADD COLUMN IF NOT EXISTS battle_reveal_index int NOT NULL DEFAULT 0;

-- 2) Widen the recap_state CHECK.
--
-- 0020 declared the CHECK inline on ADD COLUMN, so it carries a Postgres-generated
-- name (almost certainly game_sets_recap_state_check, but that is an assumption we
-- must not bet the migration on). This drops it by LOOKUP rather than by name.
--
-- Why not the usual `DO $$ BEGIN ALTER TABLE ... DROP CONSTRAINT <name>;
-- EXCEPTION WHEN others THEN null; END $$;` guard: Postgres ANDs all CHECK
-- constraints on a column. If the hardcoded name were wrong, the DROP would be
-- silently swallowed by the exception guard, the ADD below would succeed, and the
-- table would end up with BOTH the old (3-value) and new (4-value) checks — the
-- old one still rejecting 'battle_reveal'. The migration would report success
-- while the feature stayed broken at runtime, with no error to trace. Looking the
-- name up from pg_constraint removes that failure mode entirely and is idempotent
-- on re-run (the loop simply finds the constraint added below and re-adds it).
DO $$
DECLARE
  con_name text;
BEGIN
  FOR con_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'game_sets'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%recap_state%'
  LOOP
    EXECUTE format('ALTER TABLE game_sets DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

-- Re-add under an explicit, known name so any future migration can target it
-- directly instead of repeating the lookup above.
DO $$ BEGIN
  ALTER TABLE game_sets
    ADD CONSTRAINT game_sets_recap_state_check
      CHECK (recap_state IN ('pending', 'battle_reveal', 'revealing', 'complete'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
