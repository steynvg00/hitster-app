-- =============================================================================
-- Hitster — Session 6: submission status
-- Tracks whether a submission was auto-scored, flagged for review, or decided.
-- =============================================================================

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'auto_wrong'
  CHECK (status IN ('auto_correct', 'auto_wrong', 'review_requested', 'review_approved', 'review_rejected'));

-- Back-fill: anything with a positive score was auto-correct
UPDATE submissions
  SET status = CASE WHEN score > 0 THEN 'auto_correct' ELSE 'auto_wrong' END;

-- Enable realtime for review queue (admin subscribes to status changes)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE submissions;
EXCEPTION WHEN others THEN null;
END $$;
