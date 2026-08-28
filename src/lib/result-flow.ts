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
 * WANNEER de instapfase van een verse inlevering vastgelegd mag worden.
 *
 * Dit is de fix voor de verdwenen strafkaart, en de reden dat het een eigen
 * functie is in plaats van een regel in een $effect is dat de fout precies in
 * die regel zat en er niet uit te lezen was.
 *
 * ── WAT ER MIS GING ─────────────────────────────────────────────────────────
 *
 * `use:enhance` van SvelteKit (2.58.0, runtime/app/forms.js) doet na een
 * geslaagde actie TWEE dingen, in deze volgorde:
 *
 *   1. await invalidateAll()   de load draait opnieuw -> `data` is nieuw
 *   2. await applyAction()     de terugkeerwaarde landt -> `form` is nieuw
 *
 * Na stap 1 staat de inzending al in de database, dus `data.priorResult` is
 * gevuld en `result` op de pagina wordt waar. De TOEGEKENDE POWERUPS bestaan op
 * dat moment nog nergens: die zitten alleen in de terugkeerwaarde van de actie,
 * en die komt pas in stap 2. Wie de instapfase in stap 1 uitrekent, telt een
 * lege strafwachtrij en landt op 'points'.
 *
 * Daarna is er geen weg terug. `nextPhase` loopt alleen vooruit
 * (penalty -> points -> powerups -> details), en het instap-effect zelf is
 * afgeschermd met "alleen als er nog geen fase is". De straf die in stap 2
 * binnenkomt blijft in de wachtrij staan en wordt nooit gerenderd:
 * `{#if resultPhase === 'penalty' && penaltyQueue.length > 0}` is nooit waar.
 * Daarmee wordt acknowledged_at ook nooit geschreven — de rij blijft
 * onaangetikt, en dat is precies wat er in de database te zien was.
 *
 * ── DE REGEL ────────────────────────────────────────────────────────────────
 *
 * `settled` is "er is geen inlevering meer onderweg" — op de pagina de
 * omkering van `submitting`, die pas op false gaat NA `await update()`, dus na
 * allebei de stappen hierboven. `inboxPending` is de wachtkamer tussen "de
 * server heeft iets toegekend" en "de kaart gaat open"; zolang die niet leeg is
 * staat nog niet vast wat er in de wachtrijen komt.
 *
 * Zolang één van beide nog loopt: GEEN fase. `null` betekent hier "nog niet
 * beslissen", niet "geen resultaat" — het aanroepende effect laat de fase dan
 * ongemoeid en probeert het opnieuw zodra er iets verandert.
 *
 * Alle argumenten worden onvoorwaardelijk gelezen. Dat is met opzet: in een
 * $effect bepaalt de eerste `return` welke signalen het effect volgt, en een
 * afgekorte voorwaarde laat een effect achter dat niet meer wakker wordt van
 * het signaal waar het op wacht. Dat was hier de tweede helft van de fout.
 */
export function freshEntry(
	hasResult: boolean,
	settled: boolean,
	inboxPending: number,
	penaltyCount: number
): ResultPhase | null {
	if (!hasResult) return null;
	if (!settled) return null;
	if (inboxPending > 0) return null;
	return freshPhase(penaltyCount);
}

/**
 * De instapfase van een speler die halverwege wegging en TERUGKOMT.
 *
 * `pendingCount` is het aantal team_powerups-rijen van deze challenge dat nog op
 * status 'pending' staat — de rijen waarover nooit een keuze is gemaakt.
 *
 * `unseenPenaltyCount` is het aantal straffen van deze challenge dat nooit is
 * weggetikt: rijen in categorie 'punishment' met acknowledged_at IS NULL
 * (migratie 0082).
 *
 *   nog een straf open  ->  'penalty', vóór alles, net als bij een verse inzending
 *   nog powerups open   ->  'points', met de belofte er weer bij
 *   niets open          ->  'details', het resultatenscherm zelf
 *   geen resultaat      ->  null, hij heeft nog niet ingeleverd
 *
 * Een terugkeerder zonder openstaande powerups gaat NIET opnieuw langs het
 * puntenscherm: die knop zou niets meer te beloven hebben.
 *
 * ── WAAROM ER EEN DERDE ARGUMENT BIJ IS ─────────────────────────────────────
 *
 * Hier stond dat een strafshot nooit terugkomt, en dat dat aanvaardbaar was
 * omdat de verplichting in activity_log staat. Dat klopte als beschrijving van
 * de code en niet als beschrijving van het spel: een straf die de speler nooit
 * te zien krijgt is geen straf maar een logregel.
 *
 * De reden dat hij niet terugkwam: penalty_shot is immediate_use, wordt bij het
 * toekennen meteen geactiveerd en staat daarna op 'consumed'. `pendingCount`
 * telt hem dus niet, en er was geen ander veld dat "gezien" bijhield.
 *
 * Dat gat trof twee paden, niet één:
 *
 *   auto-submit         de straf wordt toegekend terwijl de telefoon in iemands
 *                       zak zit. Er is geen scherm en geen terugkeerwaarde.
 *   normale inlevering  de kaart komt binnen via de terugkeerwaarde van de
 *                       submit-action. Wie de app wegdrukt vóór hij hem wegtikt,
 *                       of wie hem door welke reden dan ook niet in beeld kreeg,
 *                       heeft geen tweede kans — de waarde bestaat alleen in die
 *                       ene response.
 *
 * acknowledged_at maakt van "gezien" een duurzaam feit in plaats van een
 * toevalligheid van het moment, en dit argument is wat de flow ermee doet: zolang
 * er een straf onaangetikt is, is dát de instapfase. Daarna schuift nextPhase
 * hem door naar 'points' of 'details', precies zoals bij een verse inzending.
 */
export function resumePhase(
	hasPriorResult: boolean,
	pendingCount: number,
	unseenPenaltyCount = 0
): ResultPhase | null {
	if (!hasPriorResult) return null;
	if (unseenPenaltyCount > 0) return 'penalty';
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
