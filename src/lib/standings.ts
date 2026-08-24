/**
 * Standen-PRESENTATIE (redesign fase 5).
 *
 * Puur weergave: geen scoring, geen realtime, geen DB. Deze module bundelt de
 * twee dingen die de drie standenschermen (9 leaderboard, 10 wachtscherm,
 * 11H eindstand) delen en anders drie keer los zouden staan:
 *
 *   1. de score-gedreven KROON-conditie uit fase 2;
 *   2. de metaal-/foliepalette per eindplek uit designscherm 11H.
 *
 * Bron: design/M!XUP Player Flow v2.dc.html (const RANK[…]) en
 *       design_handoff_mixup_redesign/README.md § 11H.
 */
import { RANK_ASSETS } from '$lib/mixup-assets';

/* ══════════════════════════════════════════════════════════════════
   KROON
══════════════════════════════════════════════════════════════════ */

/**
 * De hoogste score in een lijst teams, met 0 als ondergrens.
 *
 * LET OP: dit is NIET de noemer voor balkbreedtes — die heeft elders een
 * kunstmatige ondergrens (20) zodat een lege stand geen deling door nul geeft.
 * Die ondergrens zou hier een kroon bij score 0 opleveren.
 */
export function topScoreOf(teams: readonly { score: number }[]): number {
	return Math.max(...teams.map((t) => t.score), 0);
}

/**
 * Kroon-WEERGAVE (fase 2, ongewijzigd overgenomen): zichtbaar bij elk team
 * waarvan de score gelijk is aan de hoogste score, en alleen als die boven 0
 * ligt. Bij 0-0 dus geen kroon; bij een gedeelde topscore dragen alle
 * koplopers er een.
 *
 * `game_sets.crown_holder_team_id` blijft de MECHANIEK (de +1 steal en de +2
 * uitbetaling); deze conditie is uitsluitend wat de speler ziet.
 */
export function wearsCrown(score: number, topScore: number): boolean {
	return topScore > 0 && score === topScore;
}

/* ══════════════════════════════════════════════════════════════════
   EINDPLEK — METAAL, FOLIE EN ASSET (designscherm 11H)
══════════════════════════════════════════════════════════════════ */

export type RankTier = {
	/** Rand, glow en eyebrow-kleur van de kaart. */
	accent: string;
	/** Harde schaduw onder het rangnummer (het "donkere" metaal). */
	shadow: string;
	/** Vulkleur van het rangnummer (het "lichte" metaal). */
	face: string;
	/** Foliebalk onderaan de kaart. */
	foil: string;
	/** Kroon (plek 1) of medaille (plek 2, 3, 4+). */
	asset: string;
	assetWidth: number;
	assetHeight: number;
	/** Verticale offset t.o.v. de bovenkant van de kaart (negatief = erboven). */
	assetTop: number;
	/** Alleen plek 1: het Supreme-watermerk in de kaart. */
	supreme: boolean;
};

const TIER_GOLD: RankTier = {
	accent: '#FFD75E',
	shadow: '#8A6A1E',
	face: '#FFE9A8',
	foil: 'linear-gradient(90deg,#8A6A1E,#FFE9A8 45%,#E0B84A)',
	asset: RANK_ASSETS.crown,
	assetWidth: 202,
	assetHeight: 294,
	assetTop: -130,
	supreme: true
};

const TIER_SILVER: RankTier = {
	accent: '#D6DEE9',
	shadow: '#6E7480',
	face: '#EDF3FA',
	foil: 'linear-gradient(90deg,#6E7480,#EDF3FA 45%,#B8C2D0)',
	asset: RANK_ASSETS.silver,
	assetWidth: 108,
	assetHeight: 174,
	assetTop: -78,
	supreme: false
};

const TIER_BRONZE: RankTier = {
	accent: '#E0A06A',
	shadow: '#6B3F1D',
	face: '#E7AE79',
	foil: 'linear-gradient(90deg,#6B3F1D,#E7AE79 45%,#B97440)',
	asset: RANK_ASSETS.bronze,
	assetWidth: 108,
	assetHeight: 174,
	assetTop: -78,
	supreme: false
};

/**
 * Plek 4 en lager. Dit is de TEMPLATE voor élke positie onder 3 — alleen het
 * nummer, de tag en de achterstand wisselen, de vormgeving niet. Letters wit
 * en niet doorzichtig; foliebalk de M!XUP-gradient (cyaan -> violet -> magenta).
 */
const TIER_DARK: RankTier = {
	accent: '#8E9BC9',
	shadow: '#2C3450',
	face: '#FFFFFF',
	foil: 'linear-gradient(90deg,#00E5FF,#7C4DFF 50%,#FF2DAA)',
	asset: RANK_ASSETS.dark,
	assetWidth: 108,
	assetHeight: 174,
	assetTop: -78,
	supreme: false
};

/** De metaal-/foliepalette voor een eindplek (1-based). */
export function rankTier(place: number): RankTier {
	if (place === 1) return TIER_GOLD;
	if (place === 2) return TIER_SILVER;
	if (place === 3) return TIER_BRONZE;
	return TIER_DARK;
}

/** De eyebrow boven het rangnummer: "PLEK 1 · KAMPIOEN". */
export function rankTag(place: number): string {
	if (place === 1) return 'PLEK 1 · KAMPIOEN';
	if (place === 2) return 'PLEK 2 · ZILVER';
	if (place === 3) return 'PLEK 3 · BRONS';
	return `PLEK ${place} · BUITEN HET PODIUM`;
}

/**
 * De achterstandsregel onder de score.
 *
 * Designbron: plek 1 toont de voorsprong op plek 2, plek 2 en 3 de achterstand
 * op de plek erboven, plek 4 en lager de achterstand op het podium (plek 3).
 * Gelijke standen komen in de designbron niet voor; die krijgen hier een eigen
 * regel in plaats van een misleidende "0 ACHTER".
 *
 * @param place  eindplek van dit team (1-based)
 * @param score  score van dit team
 * @param scores alle setscores, aflopend gesorteerd
 */
export function rankDelta(place: number, score: number, scores: readonly number[]): string {
	if (place === 1) {
		const runnerUp = scores[1];
		if (runnerUp === undefined) return 'ENIGE TEAM IN DE STAND';
		const lead = score - runnerUp;
		return lead > 0 ? `+${lead} VOORSPRONG` : 'GEDEELDE KOPPOSITIE';
	}

	// Plek 2 en 3 meten tegen de plek erboven; plek 4+ tegen het podium.
	const referencePlace = place <= 3 ? place - 1 : 3;
	const reference = scores[referencePlace - 1];
	if (reference === undefined) return '';

	const gap = reference - score;
	const target = place <= 3 ? `PLEK ${referencePlace}` : 'HET PODIUM';
	return gap > 0 ? `${gap} ACHTER ${target}` : `GELIJK MET ${target}`;
}
