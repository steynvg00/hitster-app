import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { createAdminClient } from '$lib/server/supabase';

type AdminClient = SupabaseClient<Database>;

/**
 * De grens waarvóór speler- en teamcookies niet meer gelden.
 *
 * ── Waarom zo ───────────────────────────────────────────────────────────────
 * De reset van een gameset draait op de host-console. Die kan de cookies van 28
 * andere telefoons niet wissen — er is geen kanaal naar toestellen die op dat
 * moment niets opvragen. Dus draait het om: de cookie zelf blijft staan, maar
 * hij TELT niet meer. Elke cookie draagt zijn uitgiftetijd mee in de
 * ondertekende waarde; ligt die vóór de epoch, dan is hij ongeldig en wist
 * hooks.server.ts hem alsnog bij het eerstvolgende verzoek van dat toestel.
 *
 * ── Waarom het maximum over ALLE sets ───────────────────────────────────────
 * De cookie weet niet bij welke set hij hoort — `players.set_id` weet dat wel,
 * maar juist die wordt door de reset op NULL gezet, dus na een reset is er niets
 * meer om op te scopen. Bovendien draait dit spel één set tegelijk. Het maximum
 * nemen betekent: één reset, waar dan ook, en iedereen begint opnieuw. Dat is
 * precies de bedoelde werking en het scheelt een opzoeking per speler.
 *
 * ── Waarom een cache ────────────────────────────────────────────────────────
 * hooks.server.ts draait op élk verzoek. Zonder cache zou elke paginaweergave
 * van elke telefoon een extra query kosten. game_sets is een handvol rijen en
 * de epoch verandert alleen bij een reset, dus 10 seconden verversing is ruim
 * genoeg: in het slechtste geval houdt een speler zijn oude sessie 10 seconden
 * langer. bumpSessionEpoch() gooit de cache van de eigen instantie meteen weg;
 * andere instanties lopen hooguit die 10 seconden achter.
 *
 * Faalt de query, dan geeft dit 0 terug: bij een onbereikbare database gaat
 * NIEMAND eruit. Uitloggen door een storing is erger dan een reset die een
 * paar seconden later doorwerkt.
 */
const CACHE_TTL_MS = 10_000;

let cachedEpoch = 0;
let cachedAt = 0;

export function invalidateSessionEpochCache(): void {
	cachedAt = 0;
}

export async function getSessionEpoch(now: number = Date.now()): Promise<number> {
	if (cachedAt !== 0 && now - cachedAt < CACHE_TTL_MS) return cachedEpoch;

	try {
		const db = createAdminClient();
		const { data, error } = await db
			.from('game_sets')
			.select('player_epoch')
			.order('player_epoch', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (error) throw new Error(error.message);
		const raw = data?.player_epoch ?? null;
		cachedEpoch = raw ? Date.parse(raw) : 0;
		if (Number.isNaN(cachedEpoch)) cachedEpoch = 0;
	} catch {
		// Zie de kop: bij twijfel niemand uitloggen.
		cachedEpoch = 0;
	}
	cachedAt = now;
	return cachedEpoch;
}

/**
 * De grens optillen naar nu — aangeroepen door resetGameState(). Vanaf dit
 * moment is elke cookie die vóór deze aanroep is uitgegeven ongeldig.
 */
export async function bumpSessionEpoch(db: AdminClient, setId: string): Promise<string[]> {
	const { error } = await db
		.from('game_sets')
		.update({ player_epoch: new Date().toISOString() })
		.eq('id', setId);
	invalidateSessionEpochCache();
	return error ? [`session epoch bump: ${error.message}`] : [];
}
