/**
 * DE RESULTAATFLOW van een ingeleverde challenge, als pure toestandsmachine.
 *
 * De volgorde die deze module vastlegt:
 *
 *   1. straf      een strafshot, apart en vóór alles
 *   2. punten     hoeveel goed van hoeveel, het percentage, en HOEVEEL powerups
 *                 er te halen zijn — het aantal, nog niet welke
 *   3. knop       één knop: powerups te halen -> "PAK JE POWERUPS",
 *                 geen -> "NAAR RESULTATEN"
 *   4. powerups   de kaarten één voor één; de laatste die bewaard of gebruikt
 *                 wordt gaat DIRECT door, zonder tussenklik
 *   5. resultaten de volledige uitsplitsing, met de knop terug naar het team
 *
 * WAAROM DIT EEN EIGEN BESTAND IS. De fasen zelf leven in
 * (game)/challenge/[id]/+page.svelte, tussen een submit-action, een
 * realtime-subscription, een count-up en een onthullingswachtrij. Dat is een
 * prima plek om ze te tónen en een slechte plek om ze te BEWIJZEN: elk van de
 * randgevallen hieronder zou anders alleen met een echte database, een echte
 * inlevering en een echte telefoon te controleren zijn.
 *
 * Hier zijn het vier functies zonder toestand, zonder DOM en zonder netwerk, en
 * daarmee is de tabel in tests/bots/verify-result-flow.ts een uitspraak over de
 * code die daadwerkelijk draait — de pagina roept deze functies aan, ze heeft
 * er geen eigen kopie van.
 */

export type ResultPhase = 'penalty' | 'points' | 'powerups' | 'details';

/**
 * Het minimum dat deze module van een toegekende powerup hoeft te weten. Bewust
 * losser dan het volledige EarnedPowerup-type: de flow beslist op twee
 * eigenschappen en niets anders, en dat moet ook te lezen zijn.
 */
export type EarnedLike = {
	type?: { category?: string | null } | null;
	/** Prijs van een Power Spin — zie promisedCount. */
	fromSpin?: boolean;
};

/**
 * Straf of prijs.
 *
 * De scheidslijn is de CATEGORIE, niet het type-id. Vandaag draagt alleen
 * penalty_shot de categorie 'punishment' (migratie 0056), maar een tweede straf
 * die ooit wordt toegevoegd landt zo vanzelf op de goede plek in de flow in
 * plaats van stilletjes als prijs mee te lopen.
 */
export function isPunishment(e: EarnedLike): boolean {
	return e.type?.category === 'punishment';
}

/** Splitst een toekenning in de twee wachtrijen die de flow kent. */
export function splitEarned<T extends EarnedLike>(list: T[]): { penalties: T[]; prizes: T[] } {
	const penalties: T[] = [];
	const prizes: T[] = [];
	for (const e of list) (isPunishment(e) ? penalties : prizes).push(e);
	return { penalties, prizes };
}

/**
 * Het aantal dat het puntenscherm belooft.
 *
 * De prijs van een Power Spin telt NIET mee. Die bestaat pas doordat de speler
 * aan het wiel trekt; hem vooraf meetellen verklapt zowel dat er een spin in zit
 * als dat die iets opgeleverd heeft. De spin zelf telt als één en zijn prijs
 * komt er tijdens de onthullingen achteraan.
 *
 * Strafshots tellen niet mee: die zijn op dit punt al afgetikt, en ze zijn geen
 * powerup om te halen.
 */
export function promisedCount(prizes: EarnedLike[]): number {
	return prizes.filter((e) => e.fromSpin !== true).length;
}

/**
 * De instapfase bij een VERSE inlevering: straf eerst, anders de punten.
 */
export function freshPhase(penaltyCount: number): ResultPhase {
	return penaltyCount > 0 ? 'penalty' : 'points';
}

/**
 * De instapfase van een speler die halverwege wegging en TERUGKOMT.
 *
 * `pendingCount` is het aantal team_powerups-rijen van deze challenge dat nog op
 * status 'pending' staat — de rijen waarover nooit een keuze is gemaakt. Dat is
 * de enige duurzame staat die de flow nodig heeft, en hij bestaat al: er is geen
 * kolom en geen migratie voor bijgekomen.
 *
 *   nog iets open  ->  'points', met de belofte er weer bij
 *   niets open     ->  'details', het resultatenscherm zelf
 *   geen resultaat ->  null, hij heeft nog niet ingeleverd
 *
 * Een terugkeerder zonder openstaande powerups gaat NIET opnieuw langs het
 * puntenscherm: die knop zou niets meer te beloven hebben.
 *
 * Een strafshot brengt hem nooit terug in fase 'penalty'. penalty_shot is
 * immediate_use en dus bij het toekennen al geactiveerd — status 'consumed', met
 * een activity_log-regel die de host op /admin/live ziet staan. De verplichting
 * gaat dus niet verloren als de speler de kaart nooit zag, maar er is ook geen
 * openstaande rij meer om hem opnieuw mee op te roepen.
 */
export function resumePhase(hasPriorResult: boolean, pendingCount: number): ResultPhase | null {
	if (!hasPriorResult) return null;
	return pendingCount > 0 ? 'points' : 'details';
}

/**
 * De enige knop op het puntenscherm. Twee bestemmingen, nooit twee knoppen.
 */
export function pointsButton(promised: number): { label: string; next: ResultPhase } {
	return promised > 0
		? { label: 'Pak je powerups', next: 'powerups' }
		: { label: 'Naar resultaten', next: 'details' };
}

/**
 * De automatische overgangen: een leeggelopen wachtrij schuift de fase door.
 *
 * Dit is waar eis 4 in zit — "zodra de laatste bewaard of gebruikt is, direct
 * door naar de resultaten". Het legen van de wachtrij ís de overgang; er komt
 * geen knop tussen.
 */
export function nextPhase(
	current: ResultPhase,
	queues: { penalties: number; prizes: number }
): ResultPhase {
	if (current === 'penalty' && queues.penalties === 0) return 'points';
	if (current === 'powerups' && queues.prizes === 0) return 'details';
	return current;
}
