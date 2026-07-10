-- Migration 0051: fix RLS SELECT gap on the remaining anon-only tables
-- (audit finding A-1 — same class as 0050's challenge_tabs fix).
--
-- game_sets, set_challenges, powerups, set_powerups, and powerup_usages had
-- SELECT policies scoped `TO anon` only (0018/0032). A signed-in host's
-- browser queries as `authenticated`, for which no policy existed — the
-- query silently returns zero rows (no error). No player-facing load
-- currently reads these six tables through the RLS-subject public client
-- (they're all read via the admin/service-role client today), so this is
-- latent rather than actively broken — but it's the exact landmine that
-- caused the challenge_tabs 500, and the next public-client read of any of
-- these tables would hit it silently.
--
-- challenge_unlocks also had this gap on SELECT (0029). Its INSERT policy
-- (`TO anon`) is correct as-is and is NOT touched here — players write
-- unlock rows; only the SELECT policy needs to open up.
--
-- Fix: drop the anon-only SELECT policies and recreate them as public
-- (no TO clause = PUBLIC, i.e. anon + authenticated), matching the 0001
-- baseline and the 0050 pattern.

DROP POLICY IF EXISTS "anon_select_game_sets" ON game_sets;
CREATE POLICY "public_select_game_sets"
    ON game_sets FOR SELECT USING (true);

DROP POLICY IF EXISTS "anon_select_set_challenges" ON set_challenges;
CREATE POLICY "public_select_set_challenges"
    ON set_challenges FOR SELECT USING (true);

DROP POLICY IF EXISTS "anon_select_powerups" ON powerups;
CREATE POLICY "public_select_powerups"
    ON powerups FOR SELECT USING (true);

DROP POLICY IF EXISTS "anon_select_set_powerups" ON set_powerups;
CREATE POLICY "public_select_set_powerups"
    ON set_powerups FOR SELECT USING (true);

DROP POLICY IF EXISTS "anon_select_powerup_usages" ON powerup_usages;
CREATE POLICY "public_select_powerup_usages"
    ON powerup_usages FOR SELECT USING (true);

DROP POLICY IF EXISTS "anon select unlocks" ON challenge_unlocks;
CREATE POLICY "public_select_challenge_unlocks"
    ON challenge_unlocks FOR SELECT USING (true);

-- ─── Cleanup: redundant anon-only players SELECT policy ───────────────────
-- 0001's "public read players" (no TO clause = PUBLIC) already grants
-- everything 0018's "anon_select_players" (TO anon) grants — RLS policies
-- are OR-combined, so the anon-only one is strictly redundant. Dropping it
-- changes no one's access.
DROP POLICY IF EXISTS "anon_select_players" ON players;
