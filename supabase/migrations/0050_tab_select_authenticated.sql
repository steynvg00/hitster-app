-- Migration 0050: fix RLS SELECT gap on challenge_tabs et al. for the
-- `authenticated` role.
--
-- 0036/0038 scoped these SELECT policies `TO anon` only. A signed-in host's
-- browser runs PostgREST queries as `authenticated`, for which no policy
-- existed — the query silently returns zero rows (no error), and
-- challenge/[id]'s load() treats that as "no tabs configured" and 500s.
-- `challenges` itself uses no TO clause (0001's "public read active
-- challenges" policy applies to all roles), which is why the challenge row
-- loads fine while its tabs don't.
--
-- Fix: drop the `TO anon` restriction so these policies match the 0001
-- public-read baseline (no TO clause = PUBLIC, i.e. anon + authenticated).

DROP POLICY IF EXISTS "anon_select_challenge_tabs" ON challenge_tabs;
CREATE POLICY "public_select_challenge_tabs"
    ON challenge_tabs FOR SELECT USING (true);

DROP POLICY IF EXISTS "anon_select_challenge_tab_source_tracks" ON challenge_tab_source_tracks;
CREATE POLICY "public_select_challenge_tab_source_tracks"
    ON challenge_tab_source_tracks FOR SELECT USING (true);

DROP POLICY IF EXISTS "anon_select_challenge_tab_clips" ON challenge_tab_clips;
CREATE POLICY "public_select_challenge_tab_clips"
    ON challenge_tab_clips FOR SELECT USING (true);

DROP POLICY IF EXISTS "anon_select_mashups" ON mashups;
CREATE POLICY "public_select_mashups"
    ON mashups FOR SELECT USING (true);

DROP POLICY IF EXISTS "anon_select_mashup_sources" ON mashup_sources;
CREATE POLICY "public_select_mashup_sources"
    ON mashup_sources FOR SELECT USING (true);
