-- Migration 0052: advisory-locked fallback team assignment (audit finding C-3)
--
-- assignTeamFallback in src/lib/server/randomize.ts read team counts with two
-- plain SELECTs, picked a team in TS, and left the players write to the caller.
-- Near-simultaneous joins (28 guests scanning NFC cards in a burst) all read
-- the same stale counts before any write lands and stack onto the same team.
-- The slot path (assign_team_slot, 0019) is lock-safe but leaks: player leave
-- deletes the row without refunding the slot, post-activation count edits
-- don't regenerate slots, and script-seeded sets bypass activation entirely —
-- so the fallback WILL fire mid-event and must be genuinely serialized.
--
-- This function does the whole assignment in ONE transaction:
--   advisory lock (keyed per set) → count players per team (scoped to the
--   set's first N team colors) → random pick among lowest-count ties →
--   UPDATE players → return the team id.
--
-- pg_advisory_xact_lock (not a game_sets row lock) so a join burst doesn't
-- queue behind unrelated game_sets writes (play_state flips, lobby updates);
-- the lock releases automatically at transaction end.

CREATE OR REPLACE FUNCTION assign_team_fallback(
  p_set_id uuid,
  p_player_id uuid,
  p_team_count int
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  -- Must match TEAM_COLOR_ORDER in src/lib/server/randomize.ts
  v_colors text[] := ARRAY['blue','yellow','green','red','indigo','black'];
  v_team_id uuid;
BEGIN
  -- Serialize all fallback assignments for this set. Concurrent callers queue
  -- here; each sees the committed players write of the one before it.
  PERFORM pg_advisory_xact_lock(hashtext(p_set_id::text));

  SELECT t.id INTO v_team_id
  FROM teams t
  LEFT JOIN players p ON p.team_id = t.id AND p.set_id = p_set_id
  WHERE t.color = ANY (v_colors[1:p_team_count])
  GROUP BY t.id
  ORDER BY count(p.id) ASC, random()
  LIMIT 1;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'assign_team_fallback: no teams configured for set %', p_set_id;
  END IF;

  -- The write MUST happen inside this transaction — returning the pick and
  -- letting the caller write later reopens the race window.
  UPDATE players SET set_id = p_set_id, team_id = v_team_id WHERE id = p_player_id;

  RETURN v_team_id;
END;
$$;
