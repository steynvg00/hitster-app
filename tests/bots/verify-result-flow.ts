// GEDRAGSCONTROLE voor de resultaatflow van een ingeleverde challenge.
//
//   npm run bots:verify-result-flow
//
// ── Wat hier bewaakt wordt ───────────────────────────────────────────────────
//
// De gevraagde volgorde, als eigenschap van de code in plaats van als belofte:
//
//   1. is er een strafshot, dan komt die EERST en apart
//   2. dan het puntenscherm, met het AANTAL te halen powerups
//   3. één knop: powerups -> "PAK JE POWERUPS", geen -> "NAAR RESULTATEN"
//   4. powerups één voor één; de laatste gaat DIRECT door, zonder tussenklik
//   5. resultaten
//
// plus de vier randgevallen: straf mét powerups, straf zonder powerups, geen
// van beide, en de speler die halverwege wegging en terugkomt.
//
// ── Waarom dit kan zonder database ───────────────────────────────────────────
//
// De fasebeslissingen staan in src/lib/result-flow.ts en zijn puur: geen DOM,
// geen netwerk, geen Supabase. De challenge-pagina heeft er GEEN eigen kopie
// van maar roept diezelfde functies aan, dus wat hier groen is, is groen in het
// scherm. De laatste controle in dit bestand bewaakt precies dat: zodra de
// pagina de fasen weer zelf gaat uitrekenen, wordt hij rood.
//
// Er wordt geen SQL gedraaid en geen migratie uitgevoerd; dit bestand leest
// alleen.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	freshEntry,
	freshPhase,
	nextPhase,
	pointsButton,
	promisedCount,
	resumePhase,
	splitEarned,
	type EarnedLike,
	type ResultPhase
} from '../../src/lib/result-flow.ts';

const straf = (): EarnedLike => ({ type: { category: 'punishment' } });
const prijs = (): EarnedLike => ({ type: { category: 'defensive' } });
const spinPrijs = (): EarnedLike => ({ type: { category: 'defensive' }, fromSpin: true });

type Stap = { fase: ResultPhase; toont: string };

/**
 * Speelt de flow af zoals het scherm hem afspeelt: instapfase bepalen, dan per
 * fase de wachtrij leegtikken en de automatische overgangen laten lopen.
 *
 * `klik` is de enige plek waar de speler zelf iets doet — dat is precies wat
 * eis 3 en eis 4 samen zeggen: één knop op het puntenscherm, en daarna niets
 * meer tot de resultaten.
 */
function speelAf(toegekend: EarnedLike[]): { stappen: Stap[]; kliks: number } {
	const { penalties, prizes } = splitEarned(toegekend);
	let penaltyQueue = penalties.length;
	let prizeQueue = prizes.length;

	let fase: ResultPhase = freshPhase(penaltyQueue);
	const stappen: Stap[] = [];
	let kliks = 0;

	for (let veiligheid = 0; veiligheid < 50; veiligheid++) {
		if (fase === 'penalty') {
			stappen.push({ fase, toont: `strafkaart (${penaltyQueue} in de rij)` });
			penaltyQueue = 0; // speler tikt hem weg
		} else if (fase === 'points') {
			const belofte = promisedCount(prizes.slice(prizes.length - prizeQueue));
			const knop = pointsButton(belofte);
			stappen.push({ fase, toont: `puntenscherm · knop "${knop.label}" · belofte ${belofte}` });
			kliks++;
			fase = knop.next;
			continue;
		} else if (fase === 'powerups') {
			stappen.push({ fase, toont: `${prizeQueue} onthullingskaart(en)` });
			prizeQueue = 0; // speler bewaart/gebruikt ze één voor één
		} else {
			stappen.push({ fase, toont: 'resultaten + knop naar de teamconsole' });
			break;
		}
		const volgende = nextPhase(fase, { penalties: penaltyQueue, prizes: prizeQueue });
		if (volgende === fase) break;
		fase = volgende;
	}
	return { stappen, kliks };
}

type Uitslag = { ok: boolean; detail: string };
const results: Uitslag[] = [];

function check(naam: string, ok: boolean, detail: string) {
	results.push({ ok, detail: `${naam} — ${detail}` });
}

// ── Randgeval 1: straf ÉN powerups ──────────────────────────────────────────
{
	const { stappen, kliks } = speelAf([straf(), prijs(), prijs()]);
	const volgorde = stappen.map((s) => s.fase).join(' -> ');
	check(
		'straf + powerups',
		volgorde === 'penalty -> points -> powerups -> details' && kliks === 1,
		`${volgorde} (${kliks} klik) | ${stappen.map((s) => s.toont).join(' | ')}`
	);
}

// ── Randgeval 2: straf ZONDER powerups ──────────────────────────────────────
{
	const { stappen, kliks } = speelAf([straf()]);
	const volgorde = stappen.map((s) => s.fase).join(' -> ');
	const knopTekst = stappen.find((s) => s.fase === 'points')?.toont ?? '';
	check(
		'straf zonder powerups',
		volgorde === 'penalty -> points -> details' &&
			kliks === 1 &&
			knopTekst.includes('Naar resultaten'),
		`${volgorde} (${kliks} klik) | ${knopTekst}`
	);
}

// ── Randgeval 3: geen straf, geen powerups ──────────────────────────────────
{
	const { stappen, kliks } = speelAf([]);
	const volgorde = stappen.map((s) => s.fase).join(' -> ');
	check(
		'geen straf, geen powerups',
		volgorde === 'points -> details' && kliks === 1,
		`${volgorde} (${kliks} klik) | ${stappen[0].toont}`
	);
}

// ── Randgeval 3b: powerups zonder straf ─────────────────────────────────────
{
	const { stappen, kliks } = speelAf([prijs()]);
	const volgorde = stappen.map((s) => s.fase).join(' -> ');
	const knopTekst = stappen.find((s) => s.fase === 'points')?.toont ?? '';
	check(
		'powerups zonder straf',
		volgorde === 'points -> powerups -> details' &&
			kliks === 1 &&
			knopTekst.includes('Pak je powerups'),
		`${volgorde} (${kliks} klik) | ${knopTekst}`
	);
}

// ── Eis 4: geen tussenklik tussen de laatste kaart en de resultaten ─────────
{
	const naLaatsteKaart = nextPhase('powerups', { penalties: 0, prizes: 0 });
	check(
		'geen tussenklik na de laatste kaart',
		naLaatsteKaart === 'details',
		`lege wachtrij in fase 'powerups' schuift meteen door naar '${naLaatsteKaart}'`
	);
	const nogEenOver = nextPhase('powerups', { penalties: 0, prizes: 1 });
	check(
		'niet te vroeg doorschuiven',
		nogEenOver === 'powerups',
		`met nog 1 kaart in de rij blijft de fase '${nogEenOver}'`
	);
}

// ── Randgeval 4: speler sluit halverwege af en komt terug ───────────────────
{
	const tijdensPunten = resumePhase(true, 2);
	const tijdensOnthullingen = resumePhase(true, 1);
	const naAfloop = resumePhase(true, 0);
	const nooitIngeleverd = resumePhase(false, 0);
	check(
		'terugkeer tijdens het puntenscherm',
		tijdensPunten === 'points',
		`2 openstaande powerups -> '${tijdensPunten}', met de belofte er weer bij`
	);
	check(
		'terugkeer halverwege de onthullingen',
		tijdensOnthullingen === 'points',
		`1 openstaande powerup -> '${tijdensOnthullingen}' (de al afgehandelde kaarten komen niet terug)`
	);
	check(
		'terugkeer na afloop',
		naAfloop === 'details',
		`niets meer open -> '${naAfloop}', niet opnieuw langs een knop die niets belooft`
	);
	check(
		'terugkeer zonder inlevering',
		nooitIngeleverd === null,
		`geen resultaat -> ${nooitIngeleverd} (het antwoordformulier blijft staan)`
	);
}

// ── Randgeval 5: de straf die de speler nooit gezien heeft ──────────────────
//
// Twee paden komen hier samen, en allebei kwamen ze eerder niet aan bij de
// speler. penalty_shot is immediate_use: hij is bij het toekennen al geactiveerd
// en staat op 'consumed', dus `pendingCount` telt hem niet. Het derde argument
// telt iets anders: straffen met acknowledged_at IS NULL (migratie 0082) — is de
// kaart in beeld geweest, ja of nee.
//
//   auto-submit         de straf wordt toegekend terwijl de telefoon in iemands
//                       zak zit. Geen scherm, geen terugkeerwaarde.
//   gewone inlevering   de kaart komt uit de submit-response. Wie hem niet
//                       wegtikt, heeft geen tweede kans — die waarde bestaat
//                       alleen in die ene response.
{
	const naAutoSubmit = resumePhase(true, 0, 1);
	check(
		'straf na auto-submit',
		naAutoSubmit === 'penalty',
		`niets 'pending', één onaangetikte straf -> '${naAutoSubmit}' — precies het geval waarin de speler nooit een scherm zag`
	);

	// En daarna gewoon de rest van de flow, net als bij een verse inzending.
	const naDeStraf = nextPhase('penalty', { penalties: 0, prizes: 0 });
	const daarna = nextPhase('points', { penalties: 0, prizes: 0 });
	check(
		'de straf blokkeert de flow niet',
		naDeStraf === 'points' && daarna === 'points',
		`weggetikt -> '${naDeStraf}', en het puntenscherm heeft zijn eigen knop naar de resultaten`
	);

	// Straf én openstaande powerups: de straf gaat vóór, de belofte blijft staan.
	const metPowerups = resumePhase(true, 2, 1);
	check(
		'straf gaat vóór openstaande powerups',
		metPowerups === 'penalty',
		`2 open powerups + 1 onaangetikte straf -> '${metPowerups}', niet meteen naar de belofte`
	);

	// Regressie: zonder onaangetikte straf verandert er niets aan wat er was.
	const zonderStraf = resumePhase(true, 1, 0);
	const zonderStrafNietsOpen = resumePhase(true, 0, 0);
	const oudeAanroep = resumePhase(true, 0);
	check(
		'zonder straf blijft het gedrag ongewijzigd',
		zonderStraf === 'points' && zonderStrafNietsOpen === 'details' && oudeAanroep === 'details',
		`1 open -> '${zonderStraf}', niets open -> '${zonderStrafNietsOpen}', en een aanroep zonder derde argument -> '${oudeAanroep}'`
	);

	// Een speler die nog niet ingeleverd heeft, krijgt geen strafkaart voor zijn
	// antwoordformulier — ook niet als er een oude onaangetikte rij zou staan.
	const nooitIngeleverd = resumePhase(false, 0, 1);
	check(
		'geen resultaat, geen strafkaart',
		nooitIngeleverd === null,
		`${nooitIngeleverd} — het antwoordformulier blijft staan`
	);
}

// ── REGRESSIE: de straf staat in de DB maar wordt niet getoond ──────────────
//
// Dit is het geval dat op het toestel misging en dat de tabel hierboven NIET
// ving: er is een strafkaart toegekend, de rij staat met acknowledged_at IS NULL
// in team_powerups, en de speler krijgt hem toch nooit te zien.
//
// De reden zit niet in een van de fasefuncties maar in het MOMENT waarop de
// instapfase vastgelegd wordt. `use:enhance` van SvelteKit doet na een geslaagde
// actie twee stappen, in deze volgorde (2.58.0, runtime/app/forms.js):
//
//   stap 1  await invalidateAll()   de load draait opnieuw  -> `data` is nieuw
//   stap 2  await applyAction()     de terugkeerwaarde landt -> `form` is nieuw
//
// Na stap 1 staat de inzending al in de database, dus `data.priorResult` is
// gevuld en `result` is waar — terwijl `earnedPowerups`, en dus de straf, pas in
// stap 2 bestaat. Wie in stap 1 beslist, telt een lege strafwachtrij.
//
// De simulatie hieronder loopt precies die twee stappen af en gebruikt daarvoor
// de ECHTE functies. Hij is daarmee een uitspraak over de code die draait, niet
// over een nabouw ervan.
{
	type Stand = {
		result: boolean;
		submitting: boolean;
		inbox: number;
		penalties: number;
		prizes: number;
		fase: ResultPhase | null;
	};

	/** Eén beslismoment, zoals het $effect op de pagina hem doet. */
	function beslis(s: Stand): Stand {
		if (s.fase !== null) return s;
		const instap = freshEntry(s.result, !s.submitting, s.inbox, s.penalties);
		return instap ? { ...s, fase: instap } : s;
	}

	/**
	 * De volledige verse inlevering, met de twee stappen uit elkaar getrokken.
	 * `toegekend` is wat de submit-action teruggeeft.
	 */
	function leverIn(toegekend: EarnedLike[]): { fase: ResultPhase | null; strafInRij: number } {
		const { penalties, prizes } = splitEarned(toegekend);
		// Vertrekpunt: het antwoordformulier staat in beeld, de POST is onderweg.
		let s: Stand = {
			result: false,
			submitting: true,
			inbox: 0,
			penalties: 0,
			prizes: 0,
			fase: null
		};

		// STAP 1 — invalidateAll: `data.priorResult` is gevuld, `form` nog niet.
		s = beslis({ ...s, result: true });

		// STAP 2 — applyAction: de terugkeerwaarde landt in de wachtkamer …
		s = beslis({ ...s, inbox: toegekend.length });
		// … en de wachtkamer loopt leeg in de wachtrijen.
		s = beslis({ ...s, inbox: 0, penalties: penalties.length, prizes: prizes.length });

		// Pas hierna zet de enhance-callback `submitting` op false.
		s = beslis({ ...s, submitting: false });

		return { fase: s.fase, strafInRij: s.penalties };
	}

	const metStraf = leverIn([straf(), prijs(), prijs()]);
	check(
		'verse inlevering met straf landt op de strafkaart',
		metStraf.fase === 'penalty' && metStraf.strafInRij === 1,
		`na de twee enhance-stappen -> '${metStraf.fase}' met ${metStraf.strafInRij} straf in de rij — niet 'points' met een straf die blijft staan`
	);

	const zonderStraf = leverIn([prijs()]);
	check(
		'verse inlevering zonder straf blijft op het puntenscherm',
		zonderStraf.fase === 'points',
		`-> '${zonderStraf.fase}', ongewijzigd gedrag`
	);

	// DE FALSIFICATIE, en meteen de kern van de bug: beslissen zodra `result` waar
	// is — de oude regel — zet de fase in stap 1 vast op 'points'. De straf komt
	// daarna binnen en er is geen weg terug, want nextPhase loopt alleen vooruit.
	{
		const inStap1 = freshPhase(0); // strafwachtrij is in stap 1 per definitie leeg
		const naDeStraf = nextPhase(inStap1, { penalties: 1, prizes: 2 });
		check(
			'falsificatie · de oude regel verliest de straf aantoonbaar',
			inStap1 === 'points' && naDeStraf === 'points',
			`beslissen in stap 1 geeft '${inStap1}', en met een straf in de rij blijft dat '${naDeStraf}' — de kaart wordt nooit gerenderd en acknowledged_at wordt nooit geschreven`
		);
	}

	// De poort zelf, los: zolang er iets onderweg is valt er niets te beslissen.
	const tijdensStap1 = freshEntry(true, false, 0, 0);
	const wachtkamerVol = freshEntry(true, true, 3, 0);
	const nogGeenResultaat = freshEntry(false, true, 0, 1);
	check(
		'freshEntry wacht tot de inlevering rond is',
		tijdensStap1 === null && wachtkamerVol === null && nogGeenResultaat === null,
		`onderweg -> ${tijdensStap1}, wachtkamer nog vol -> ${wachtkamerVol}, geen resultaat -> ${nogGeenResultaat}`
	);
}

// ── De belofte: het AANTAL, en de Power Spin-prijs telt niet mee ────────────
{
	const metSpin = promisedCount([prijs(), spinPrijs()]);
	const zonder = promisedCount([prijs(), prijs()]);
	check(
		'belofte telt de spin-prijs niet mee',
		metSpin === 1 && zonder === 2,
		`spin + prijs -> ${metSpin} beloofd (de prijs is een gevolg van het wiel, geen aparte toekenning); twee gewone -> ${zonder}`
	);
}

// ── De scheidslijn is de CATEGORIE, niet het type-id ────────────────────────
{
	const { penalties, prizes } = splitEarned([
		{ type: { category: 'punishment' } },
		{ type: { category: 'offensive' } },
		{ type: null },
		{}
	]);
	check(
		'straf/prijs op categorie',
		penalties.length === 1 && prizes.length === 3,
		`1 straf, 3 prijzen — een toekenning zonder type valt aan de prijskant, nooit per ongeluk als straf`
	);
}

// ── Bewaakt dat de PAGINA deze module echt gebruikt ─────────────────────────
// Zonder deze controle zou alles hierboven groen blijven terwijl het scherm zijn
// eigen fasen uitrekent, en dan bewijst dit bestand niets over wat de speler ziet.
{
	const bron = readFileSync(
		resolve(process.cwd(), 'src/routes/(game)/challenge/[id]/+page.svelte'),
		'utf8'
	);
	const importeert = /from '\$lib\/result-flow'/.test(bron);
	const nodig = ['freshEntry', 'nextPhase', 'pointsButton', 'promisedCount', 'resumePhase'];
	const ontbreekt = nodig.filter((fn) => !new RegExp(`\\b${fn}\\s*\\(`).test(bron));
	check(
		'de challenge-pagina gebruikt deze module',
		importeert && ontbreekt.length === 0,
		importeert && ontbreekt.length === 0
			? `roept alle vijf de beslissingen hier aan (${nodig.join(', ')})`
			: `pagina rekent fasen zelf uit — ontbrekend: ${ontbreekt.join(', ') || 'de import'}`
	);

	// De instapfase moet de INLEVERING-ONDERWEG-stand meekrijgen, en die staat op
	// de pagina in `submitting`. Zonder dat argument beslist het effect weer in
	// stap 1 van enhance en is de straf opnieuw weg — de regressie zelf.
	const poortOpSubmitting = /freshEntry\(\s*!!result,\s*!submitting,/.test(bron);
	// En `submitting` moet ook echt aflopen als update() gooit, anders komt de
	// speler nooit voorbij het antwoordformulier.
	const submittingLooptAf = /finally\s*\{\s*submitting = false;/.test(bron);
	check(
		'de instapfase wacht op een afgeronde inlevering',
		poortOpSubmitting && submittingLooptAf,
		poortOpSubmitting && submittingLooptAf
			? 'freshEntry krijgt !submitting mee, en submitting loopt in een finally af'
			: `!submitting meegegeven: ${poortOpSubmitting}, finally aanwezig: ${submittingLooptAf}`
	);

	// De straf-resume is pas echt aangesloten als de pagina de derde bron ook
	// binnenhaalt, in de strafwachtrij zet, en het wegtikken vastlegt. Zonder deze
	// drie zou alles hierboven groen zijn terwijl de speler nog steeds niets ziet.
	const leestBron = /data\.unseenPenalties/.test(bron);
	const inStrafwachtrij = /penaltyQueue\s*=\s*\[[^\]]*nieuw\]/.test(bron);
	const tiktAf = /acknowledgePowerup/.test(bron) && /tikStrafAf\(/.test(bron);
	check(
		'de straf-resume is aangesloten',
		leestBron && inStrafwachtrij && tiktAf,
		leestBron && inStrafwachtrij && tiktAf
			? 'de pagina leest unseenPenalties, vult er de strafwachtrij mee, en legt het wegtikken vast'
			: `unseenPenalties gelezen: ${leestBron}, in de wachtrij: ${inStrafwachtrij}, wegtikken vastgelegd: ${tiktAf}`
	);

	// De bron mag GEEN momentopname bij het mounten zijn. Een eenmalige vlag
	// (`if (seededPenalties) return`) leest `data.unseenPenalties` precies één
	// keer, en zet daarmee het vangnet uit 0082 uit voor elke straf die pas bij
	// een latere invalidateAll in `data` verschijnt — wat na élke inlevering
	// gebeurt. Herhaalbaar lezen mag alleen met dubbelbescherming op id.
	// Op de CODE, niet op het woord: het docblock ernaast citeert de oude regel
	// met opzet, en dat citaat moet blijven staan.
	const eenmaligeSeed = /^\s*if \(seededPenalties\) return;/m.test(bron);
	const dedupOpId = /straffenInBeeldGeweest\.has\(/.test(bron);
	check(
		'de straf-bron is herhaalbaar, met dubbelbescherming op id',
		!eenmaligeSeed && dedupOpId,
		!eenmaligeSeed && dedupOpId
			? 'geen eenmalige seed-vlag meer; dubbelen worden op teamPowerupId geweerd'
			: `eenmalige seed aanwezig: ${eenmaligeSeed}, dedup op id: ${dedupOpId}`
	);
}

// ── De server levert de straffen ook echt aan ───────────────────────────────
// De pagina kan niets tonen wat de load niet meestuurt, en de load kan alleen op
// acknowledged_at filteren — niet op status, want een straf staat op 'consumed'.
{
	const bron = readFileSync(
		resolve(process.cwd(), 'src/routes/(game)/challenge/[id]/+page.server.ts'),
		'utf8'
	);
	const opAcknowledged = /\.is\('acknowledged_at', null\)/.test(bron);
	const opCategorie = /'powerup_types\.category',\s*'punishment'/.test(bron);
	const stuurtMee = /\n\t\tunseenPenalties,/.test(bron);
	const schrijftTerug = /acknowledgePowerup:\s*async/.test(bron);
	check(
		'de load levert de onaangetikte straffen',
		opAcknowledged && opCategorie && stuurtMee && schrijftTerug,
		opAcknowledged && opCategorie && stuurtMee && schrijftTerug
			? "gefilterd op acknowledged_at IS NULL en categorie 'punishment', meegestuurd, en er is een actie die het terugschrijft"
			: `acknowledged_at-filter: ${opAcknowledged}, categoriefilter: ${opCategorie}, meegestuurd: ${stuurtMee}, schrijfactie: ${schrijftTerug}`
	);
}

// ── Falsificatie: gaat dit bestand ook echt rood? ───────────────────────────
// Zonder dit zou een tabel die altijd groen is er even overtuigend uitzien.
{
	const stukkeVolgorde = nextPhase('powerups', { penalties: 0, prizes: 0 }) === 'powerups';
	check(
		'falsificatie',
		!stukkeVolgorde,
		stukkeVolgorde
			? 'de overgang doet niets — de controles hierboven bewijzen niets'
			: "een fase die NIET doorschuift zou hier rood worden; 'powerups' met lege rij doet dat wel"
	);
}

let failed = 0;
for (const r of results) {
	console.log(`${r.ok ? '✅' : '❌'} ${r.detail}`);
	if (!r.ok) failed++;
}
console.log(failed === 0 ? '\nAlles groen.' : `\n${failed} controle(s) rood.`);
process.exit(failed === 0 ? 0 : 1);
