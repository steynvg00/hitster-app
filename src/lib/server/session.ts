import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cookies } from '@sveltejs/kit';
import type { Database } from '$lib/types/database';
import { PLAYER_SESSION_MAX_AGE_SECONDS, setPlayerCookie } from '$lib/server/player';
import { setTeamCookie } from '$lib/server/team';

type AdminClient = SupabaseClient<Database>;

/**
 * Een terugkerende speler weer op zijn eigen sessie zetten.
 *
 * ── Waarom dit één functie is ────────────────────────────────────────────────
 * De speler- en de teamcookie hebben verschillende levensduren (48 uur tegen
 * 7 dagen) en werden op verschillende plekken uitgegeven: de spelerscookie in
 * play/[mode], de teamcookie in de join-flow. Daardoor konden ze uit elkaar
 * lopen — een geldige teamcookie zonder spelerscookie levert een /team zonder
 * `activeSetId` op (geen powerup-balk, geen challenge-lijst van de set), en de
 * sessie-epoch (zie $lib/server/session-epoch.ts) kon er maar één van raken.
 *
 * Elke plek die een speler terugzet op zijn bestaande sessie gaat hier
 * langs, zodat beide cookies dezelfde uitgiftetijd dragen en dus altijd samen
 * geldig of samen ongeldig zijn.
 *
 * ── Waarom session_expires_at meeschuift ────────────────────────────────────
 * `players.session_expires_at` is afgeleid van PLAYER_SESSION_MAX_AGE_SECONDS
 * (zie $lib/server/player.ts). Verlengen we alleen de cookie, dan zou
 * /api/player/sweep de rij onder een nog geldige cookie vandaan verwijderen.
 * Cookie en rij schuiven daarom in dezelfde handeling op.
 */
export async function resumeSession(
	db: AdminClient,
	cookies: Cookies,
	playerId: string,
	teamId: string
): Promise<void> {
	setPlayerCookie(cookies, playerId);
	setTeamCookie(cookies, teamId);

	const session_expires_at = new Date(
		Date.now() + PLAYER_SESSION_MAX_AGE_SECONDS * 1000
	).toISOString();

	await db.from('players').update({ session_expires_at }).eq('id', playerId);
}
