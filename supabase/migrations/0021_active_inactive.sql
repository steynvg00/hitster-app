-- Replace draft/active/completed status with binary active/inactive.
-- draft → inactive, completed → inactive, active → active
ALTER TABLE game_sets DROP CONSTRAINT IF EXISTS game_sets_status_check;
UPDATE game_sets SET status = 'inactive' WHERE status IN ('draft', 'completed');
ALTER TABLE game_sets ADD CONSTRAINT game_sets_status_check CHECK (status IN ('active', 'inactive'));
