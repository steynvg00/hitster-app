-- =============================================================================
-- Hitster — Session 6: review requests
-- Player submits a review request for a specific field they think was scored
-- incorrectly. Host approves or rejects from /admin/review.
-- =============================================================================

CREATE TABLE review_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid        NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  field_name    text        NOT NULL,
  player_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved      boolean     NOT NULL DEFAULT false
);

CREATE INDEX ON review_requests (submission_id);
CREATE INDEX ON review_requests (resolved);
CREATE INDEX ON review_requests (created_at DESC);

-- RLS: teams can insert; admin reads via service role (bypasses RLS)
ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teams can request review" ON review_requests
  FOR INSERT WITH CHECK (true);

-- Realtime for admin review queue
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE review_requests;
EXCEPTION WHEN others THEN null;
END $$;
