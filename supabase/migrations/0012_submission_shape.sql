-- =============================================================================
-- Hitster — Session 7: multi-track submission shape
-- Changes submissions.answers from a flat {field: value} JSONB object to an
-- array of per-track answer objects.
-- New shape: [{ track_id, field_values, scored, total }, ...]
-- Also adds is_final flag and track_id to review_requests.
-- =============================================================================

-- ── submissions ───────────────────────────────────────────────────────────────

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS is_final boolean NOT NULL DEFAULT false;

-- Mark all existing submissions as final (they were manually submitted)
UPDATE submissions SET is_final = true WHERE score IS NOT NULL;

-- Migrate answers from flat object to per-track array.
-- Guard: only rows where answers is still a JSON object (not yet migrated).
-- The subquery fetches the first challenge_track by sort_order; if the challenge
-- has no tracks (orphan submission), track_id will be null — handled in app code.
UPDATE submissions
SET answers = jsonb_build_array(
  jsonb_build_object(
    'track_id',    (
      SELECT ct.track_id::text
      FROM   challenge_tracks ct
      WHERE  ct.challenge_id = submissions.challenge_id
      ORDER  BY ct.sort_order
      LIMIT  1
    ),
    'field_values', answers,
    'scored',       '{}'::jsonb,
    'total',        COALESCE(score, 0)
  )
)
WHERE jsonb_typeof(answers) = 'object'
  AND answers IS NOT NULL
  AND answers != 'null'::jsonb;

-- ── review_requests ───────────────────────────────────────────────────────────

-- track_id is nullable for backward-compat with pre-migration review requests.
-- New requests (from multi-track challenges) will always have track_id set.
ALTER TABLE review_requests
  ADD COLUMN IF NOT EXISTS track_id uuid REFERENCES tracks(id) ON DELETE SET NULL;
