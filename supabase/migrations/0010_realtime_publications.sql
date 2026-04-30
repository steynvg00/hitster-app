-- =============================================================================
-- Hitster — Session 6b: realtime publication fix
-- Add missing tables and SELECT policies so browser-side realtime subscriptions
-- (using the anon key) can receive events. RLS blocks events for tables where
-- the anon role has no SELECT policy even if the table is in the publication.
-- =============================================================================

-- ── Add missing tables to the realtime publication ───────────────────────────

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE challenges;
EXCEPTION WHEN others THEN null;
END $$;

-- ── SELECT policies for realtime-subscribed tables ────────────────────────────

-- review_requests: admin review page and player results screen subscribe via
-- the browser anon client. Without SELECT access the realtime event is dropped.
CREATE POLICY "public read review_requests" ON review_requests
  FOR SELECT USING (true);

-- activity_log: admin live console subscribes to INSERTs. No public SELECT
-- policy existed, so the live-activity channel was always silent.
CREATE POLICY "public read activity_log" ON activity_log
  FOR SELECT USING (true);
