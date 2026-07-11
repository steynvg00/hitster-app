-- 0055_replace_set_challenges_atomic.sql
--
-- The setChallenges admin action (src/routes/admin/sets/[id]/+page.server.ts)
-- rebuilt a set's challenge list with a plain DELETE followed by a separate
-- INSERT, not wrapped in a transaction, and the DELETE's error response was
-- never checked. If the INSERT failed after the DELETE succeeded (e.g. a
-- constraint violation), the set was left with ZERO challenges permanently —
-- there was no way to recover the prior list from the client.
--
-- This function does delete + insert inside a single plpgsql function body,
-- which executes as one implicit transaction: if the INSERT raises, the
-- exception propagates, the whole function aborts, and the DELETE is rolled
-- back too — the set's existing challenges are left untouched.
--
-- p_rows is a jsonb array of {challenge_id, position, challenge_multiplier,
-- created_by} objects, matching the shape already built by the admin action.
--
-- Run manually in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION replace_set_challenges(
  p_set_id uuid,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM set_challenges WHERE set_id = p_set_id;

  IF jsonb_array_length(p_rows) > 0 THEN
    INSERT INTO set_challenges (set_id, challenge_id, position, challenge_multiplier, created_by)
    SELECT
      p_set_id,
      (r->>'challenge_id')::uuid,
      (r->>'position')::int,
      (r->>'challenge_multiplier')::numeric,
      NULLIF(r->>'created_by', '')::uuid
    FROM jsonb_array_elements(p_rows) AS r;
  END IF;
END;
$$;
