-- ─── True randomization: expected_player_count + pre-shuffled slot list ─────

ALTER TABLE game_sets
  ADD COLUMN IF NOT EXISTS expected_player_count int,
  ADD COLUMN IF NOT EXISTS assignment_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assignment_index int NOT NULL DEFAULT 0;

-- Atomic slot assignment: locks the row, pops the next slot, increments pointer.
-- Returns the team_id string, or NULL when slots are exhausted / not configured.
CREATE OR REPLACE FUNCTION assign_team_slot(p_set_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_slots jsonb;
  v_index int;
BEGIN
  SELECT assignment_slots, assignment_index
    INTO v_slots, v_index
    FROM game_sets
    WHERE id = p_set_id
    FOR UPDATE;

  IF jsonb_array_length(v_slots) > 0 AND v_index < jsonb_array_length(v_slots) THEN
    UPDATE game_sets
      SET assignment_index = assignment_index + 1
      WHERE id = p_set_id;
    RETURN v_slots ->> v_index;
  END IF;

  RETURN NULL;
END;
$$;
