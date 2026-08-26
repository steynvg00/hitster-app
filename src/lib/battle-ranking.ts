// Client-safe Battle Mode ranking math + config parsing, in its own module with
// NO server-only imports (same pattern as powerups-meta.ts) so the pure-function
// harness (tests/bots/verify-battle.ts) can import it under tsx without pulling
// in the DB layer, and .svelte surfaces can reuse the config parser.
//
// Een battle is ALLE teams tegen elkaar op één challenge — geen onderlinge
// duels. Hij is puur WEERGAVE: de challenge wordt gespeeld en gescoord als elke
// andere (volledige score, multipliers, powerups, kroon — alles bij submit), en
// de battle rangschikt daarna wat elk team op DIE challenge scoorde. Er komen
// GEEN punten bij. Het team bovenaan wint de battle, en dat is het.
//
// Historie: tot deze wijziging deelde de resolver een ladderbonus uit
// (rang 1 kreeg max, de laatste 0) die rechtstreeks in teams.score werd
// bijgeschreven. Die bonus is verwijderd — hij hoorde niet in het ontwerp.

export type BattleConfig = { enabled: boolean };

/**
 * Read + normalize the battle config off a challenge's points_config JSONB.
 * De opslagvorm is { enabled }. Oudere rijen dragen daar nog een `max_points`
 * naast (de verdwenen ladder); die wordt genegeerd, niet gemigreerd.
 */
export function parseBattleConfig(pointsConfig: unknown): BattleConfig {
	const battle = ((pointsConfig ?? {}) as Record<string, unknown>).battle as
		| { enabled?: unknown }
		| undefined;
	return { enabled: battle?.enabled === true };
}

/** Eén team in de ranglijst-invoer: wat het op deze challenge scoorde. */
export type BattleEntry = { teamId: string; score: number };

export type BattleRankEntry = {
	team_id: string;
	/**
	 * 1-based plek. Competition numbering: een gelijk blok DEELT zijn nummer en
	 * het volgende blok slaat de verbruikte plekken over (10, 10, 3e plek = 3).
	 */
	rank: number;
	/** Wat dit team op DEZE challenge scoorde — het getal dat de kaart toont. */
	score: number;
};

/**
 * Rangschik alle teams van een set op wat ze op één challenge scoorden.
 *
 * Sorteert puur op score aflopend. Gelijke score = GEDEELDE plek; er is geen
 * tijd-tiebreak meer. Dat is een bewuste keuze: het ontwerp zegt "het team met
 * de meeste punten wint", niet "het snelste team", en een gedeelde koppositie
 * is precies wat de kroonmechaniek elders ook kent.
 *
 * Teams zonder inzending horen er met score 0 gewoon in te zitten — de kaart
 * toont ALLE teams, ook wie niet meespeelde. Die 0 komt van de aanroeper.
 */
export function computeBattleRanking(entries: BattleEntry[]): BattleRankEntry[] {
	const sorted = [...entries].sort((a, b) => b.score - a.score);

	const out: BattleRankEntry[] = [];
	let i = 0;
	while (i < sorted.length) {
		// Tie-groep: identieke score bezet de plekken i..j en deelt plek i+1.
		let j = i;
		while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j++;
		for (let k = i; k <= j; k++) {
			out.push({ team_id: sorted[k].teamId, rank: i + 1, score: sorted[k].score });
		}
		i = j + 1;
	}
	return out;
}
