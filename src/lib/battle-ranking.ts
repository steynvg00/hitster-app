// Client-safe Battle Mode ranking math + config parsing, in its own module with
// NO server-only imports (same pattern as powerups-meta.ts) so the pure-function
// harness (tests/bots/verify-battle.ts) can import it under tsx without pulling
// in the DB layer, and .svelte surfaces can reuse the config parser.
//
// Een battle is ALLE teams tegen elkaar op één challenge — geen onderlinge
// duels. De challenge wordt gespeeld en gescoord als elke andere (volledige
// score, multipliers, powerups, kroon — alles bij submit), en de battle
// rangschikt daarna wat elk team op DIE challenge scoorde. Boven op die
// ranglijst komt een LADDERBONUS: aflopend per plek, waarbij de laatste plek
// niets krijgt (bij 6 teams: 10, 8, 6, 4, 2, 0).
//
// Historie: die bonus is één ronde lang verwijderd geweest (PR #100) op een
// verkeerd begrepen opdracht en is hier hersteld. Wat NIET terugkomt is de
// kroon-hercalculatie die er destijds aan hing (recomputeCrownAfterBattle) —
// een battle verplaatst de kroon niet.

export const DEFAULT_MAX_POINTS = 10;

export type BattleConfig = { enabled: boolean; max_points: number };

/**
 * Read + normalize the battle config off a challenge's points_config JSONB.
 * Storage shape is { enabled, max_points } — de ladder zelf wordt niet
 * opgeslagen, die volgt bij resolutie uit max_points + het échte team_count van
 * de set (zie deriveLadder). Rijen die tussen PR #100 en dit herstel zijn
 * opgeslagen dragen alleen { enabled }; die vallen terug op DEFAULT_MAX_POINTS.
 */
export function parseBattleConfig(pointsConfig: unknown): BattleConfig {
	const battle = ((pointsConfig ?? {}) as Record<string, unknown>).battle as
		| { enabled?: unknown; max_points?: unknown }
		| undefined;
	const enabled = battle?.enabled === true;
	const max_points =
		typeof battle?.max_points === 'number' &&
		Number.isFinite(battle.max_points) &&
		battle.max_points >= 0
			? battle.max_points
			: DEFAULT_MAX_POINTS;
	return { enabled, max_points };
}

/**
 * Derive the award ladder from a single max-points value + the real team
 * count (computed at resolution time, never stored). Linear from max down to
 * 0 in equal steps: rank r (0-indexed) awards round(M × (N-1-r)/(N-1)); de
 * LAATSTE plek landt altijd op precies 0. N=1 is a degenerate case (a 1-team
 * "battle" is meaningless) — that sole team gets 0, no division by zero.
 *
 * Examples: deriveLadder(10, 6) → [10,8,6,4,2,0]; deriveLadder(10, 4) →
 * [10,7,3,0] (6.67→7, 3.33→3, half-up rounding via Math.round).
 */
export function deriveLadder(maxPoints: number, teamCount: number): number[] {
	if (teamCount <= 1) return [0];
	const ladder: number[] = [];
	for (let r = 0; r < teamCount; r++) {
		ladder.push(Math.round((maxPoints * (teamCount - 1 - r)) / (teamCount - 1)));
	}
	return ladder;
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
	/** De ladderbonus voor die plek, die bij teams.score wordt opgeteld. */
	awarded: number;
};

/**
 * Rangschik alle teams van een set op wat ze op één challenge scoorden en ken
 * per plek de ladderbonus toe.
 *
 * Sorteert puur op score aflopend. Gelijke score = GEDEELDE plek; er is geen
 * tijd-tiebreak. Dat is een bewuste keuze: het ontwerp zegt "het team met de
 * meeste punten wint", niet "het snelste team", en een gedeelde koppositie is
 * precies wat de kroonmechaniek elders ook kent.
 *
 * Een gelijk blok krijgt de bonus van de HOOGSTE plek die het bezet — twee
 * teams gelijk aan kop krijgen dus allebei de topbonus, niet het gemiddelde van
 * plek 1 en 2 (dat was de oude regel, en die strafte een gedeelde eerste plaats
 * af). Gevolg: bij een gelijk blok onderaan krijgt niemand de nul; de "laatste
 * krijgt niets"-regel geldt per PLEK, niet per team.
 *
 * Een ladder korter dan het veld → de overtollige plekken krijgen 0.
 *
 * Teams zonder inzending horen er met score 0 gewoon in te zitten — de kaart
 * toont ALLE teams, ook wie niet meespeelde. Die 0 komt van de aanroeper.
 */
export function computeBattleRanking(entries: BattleEntry[], ladder: number[]): BattleRankEntry[] {
	const ladderAt = (pos: number) => (pos >= 0 && pos < ladder.length ? ladder[pos] : 0);
	const sorted = [...entries].sort((a, b) => b.score - a.score);

	const out: BattleRankEntry[] = [];
	let i = 0;
	while (i < sorted.length) {
		// Tie-groep: identieke score bezet de plekken i..j en deelt plek i+1.
		let j = i;
		while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j++;
		const awarded = ladderAt(i);
		for (let k = i; k <= j; k++) {
			out.push({ team_id: sorted[k].teamId, rank: i + 1, score: sorted[k].score, awarded });
		}
		i = j + 1;
	}
	return out;
}
