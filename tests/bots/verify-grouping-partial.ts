// Grouping met deelpunten — verificatie.
//
//   npm run bots:verify-grouping-partial
//
// Pure harness, geen DB. Pint de regel van scoreGrouping:
//
//   deel     = maxPoints / |A|
//   treffers = |P ∩ A|
//   surplus  = max(0, |P| − |A|)
//   score    = round(deel × max(0, treffers − surplus))
//
// De twee eigenschappen die ertoe doen en die hieronder allebei uitputtend
// worden nagelopen op de echte setvorm (3 fragmenten uit 9, 5 punten):
//
//   1. PERFECT IS PERFECT       de exacte verzameling levert exact maxPoints.
//   2. ALLES AANVINKEN IS NUL   de exploit die deelpunten zou breken — ken alle
//                               negen fragmenten aan elke beurt toe en incasseer
//                               overal de volle treffers — moet 0 opleveren, en
//                               wel bij ELKE waarde van maxPoints.

import { scoreGrouping, maxFragmentsPerSlot, type TabClipData } from '../../src/lib/server/scoring';

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass ? JSON.stringify(got) : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
	});
}
function assertTrue(name: string, cond: boolean, detail: string) {
	checks.push({ name, pass: cond, detail });
}

// De echte vorm van deze set: track A heeft {1,4,7}, de tab bevat 1..9.
const A = [1, 4, 7];
const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const MAX = 5;
const g = (picked: number[], max = MAX, actual = A) => scoreGrouping(picked, actual, max);

// ─── 1. Het hoofdgeval: elk juist fragment levert zijn deel op ───────────────

assert('3 van 3 goed → vol', g([1, 4, 7]), 5);
assert('2 van 3 goed (derde weggelaten) → 2/3', g([1, 4]), 3); // 5×2/3 = 3.33 → 3
assert('1 van 3 goed → 1/3', g([1]), 2); // 5×1/3 = 1.67 → 2
assert('0 van 3 goed, niets ingevuld → 0', g([]), 0);
assert('volgorde doet er niet toe', g([7, 1, 4]), 5);

// ─── 2. Een fout nummer BINNEN het budget straft niet extra ─────────────────
//
// Dit is de regel die scoreArtistField al hanteert: een tag die binnen het
// aantal doelen past en simpelweg niet matcht, kostte de speler zijn deel al
// door niet te matchen — hij wordt niet twee keer gestraft.

assert('2 goed + 1 fout (3 aangewezen) → 2/3, net als 2 zonder fout', g([1, 4, 2]), 3);
assertTrue(
	'…en dus exact gelijk aan hetzelfde antwoord zónder het foute nummer',
	g([1, 4, 2]) === g([1, 4]),
	`met fout: ${g([1, 4, 2])}, zonder: ${g([1, 4])}`
);
assert('1 goed + 2 fout (3 aangewezen) → 1/3', g([1, 2, 3]), 2);
assert('3 fout (3 aangewezen) → 0', g([2, 3, 5]), 0);

// ─── 3. Surplus kost een deel ───────────────────────────────────────────────

assert('3 goed + 1 extra → 2/3', g([1, 4, 7, 2]), 3); // 3 treffers − 1 surplus = 2
assert('3 goed + 2 extra → 1/3', g([1, 4, 7, 2, 3]), 2);
assert('3 goed + 3 extra → 0', g([1, 4, 7, 2, 3, 5]), 0);
// 4 aangewezen, 2 goed: 2 treffers − 1 surplus = 1 deel. De eerste twee foute
// nummers vullen het budget van 3, pas het vierde is surplus.
assert('2 goed + 2 fout (4 aangewezen) → 1/3', g([1, 4, 2, 3]), 2);
// 5 aangewezen, 2 goed: 2 treffers − 2 surplus = 0.
assert('2 goed + 3 fout (5 aangewezen) → 0', g([1, 4, 2, 3, 5]), 0);

// ─── 4. DE EXPLOIT: alles aanvinken moet nul zijn, bij elke maxPoints ───────

assert('alle 9 aangewezen → 0', g(ALL), 0);
for (const max of [1, 3, 5, 10, 20, 50, 100]) {
	assertTrue(
		`alle 9 aangewezen → 0, ook bij max ${max}`,
		g(ALL, max) === 0,
		`kreeg ${g(ALL, max)}`
	);
}
// De reden dat een vaste straf van één punt (zoals bij artiesten) hier niet zou
// volstaan: bij max 20 zou "alles aanvinken" 20 − 6 = 14 opleveren.
assertTrue(
	'…en dat is precies wat een vaste straf van 1 punt NIET zou doen',
	20 - 6 > 0,
	'een vaste straf van 1/surplus zou bij max 20 nog 14 van de 20 laten staan'
);

// ─── 5. Randgevallen ────────────────────────────────────────────────────────

assert(
	'track zonder fragmentnummers → 0, ook bij een perfecte gok',
	scoreGrouping([1, 4, 7], [], MAX),
	0
);
assert('track zonder fragmentnummers → 0 bij lege inzending', scoreGrouping([], [], MAX), 0);
assert('dubbele invoer telt één keer', g([1, 1, 1]), 2); // {1} → 1 treffer, geen surplus
assert('dubbele invoer maakt geen surplus', g([1, 4, 7, 7, 7]), 5); // {1,4,7} → perfect
assert('onbestaand nummer telt als een gewone misser', g([1, 4, 99]), 3);
assert('maxPoints 0 → 0', g([1, 4, 7], 0), 0);
assert('één fragment per track, goed', scoreGrouping([5], [5], MAX), 5);
assert('één fragment per track, fout', scoreGrouping([6], [5], MAX), 0);
assert('één fragment per track, goed + 1 extra', scoreGrouping([5, 6], [5], MAX), 0); // 1 − 1 = 0

// ─── 6. Eigenschappen, uitputtend over alle 512 deelverzamelingen van 1..9 ──

{
	let perfectCount = 0;
	let overMax = 0;
	let negative = 0;
	let nonMonotone = 0;
	for (let mask = 0; mask < 1 << 9; mask++) {
		const picked = ALL.filter((_, i) => mask & (1 << i));
		const s = g(picked);
		if (s > MAX) overMax++;
		if (s < 0) negative++;
		if (s === MAX) perfectCount++;
		// Monotoon: een fragment TOEVOEGEN dat niet in A zit mag de score nooit
		// verhogen (het is hooguit surplus).
		for (const extra of ALL) {
			if (picked.includes(extra) || A.includes(extra)) continue;
			if (g([...picked, extra]) > s) nonMonotone++;
		}
	}
	assert('geen enkele deelverzameling scoort boven max', overMax, 0);
	assert('geen enkele deelverzameling scoort negatief', negative, 0);
	assert('precies één deelverzameling scoort vol: {1,4,7}', perfectCount, 1);
	assert('een fout fragment toevoegen verhoogt nooit de score', nonMonotone, 0);
}

// ─── 7. De gok-ondergrens, expliciet vastgelegd ─────────────────────────────
//
// Niet omdat het fout is, maar omdat het een eigenschap is die je moet kennen:
// drie willekeurige nummers uit negen leveren gemiddeld één treffer op, dus een
// derde van de punten. Dat is de prijs van deelpunten op een kleine gesloten
// verzameling. Wordt in het rapport doorgerekend naar setniveau.

{
	let total = 0;
	let n = 0;
	for (let i = 0; i < ALL.length; i++)
		for (let j = i + 1; j < ALL.length; j++)
			for (let k = j + 1; k < ALL.length; k++) {
				total += g([ALL[i], ALL[j], ALL[k]]);
				n++;
			}
	const avg = total / n;
	assert('alle 84 drietallen doorgerekend', n, 84);
	// Verwachte treffers = 3 × 3/9 = 1, dus een derde van de punten = 1,67. Door
	// naar boven afronden op een 5-puntenveld (1 treffer -> 2) komt het gemiddelde
	// uit op 149/84 = 1,77 — oftewel 35 % van de punten voor een willekeurige gok.
	assertTrue(
		'willekeurig drietal levert gemiddeld 35 % van de punten',
		avg > 1.7 && avg < 1.85,
		`gemiddeld ${avg.toFixed(2)} van ${MAX} = ${Math.round((avg / MAX) * 100)} %`
	);
}

// ─── De bovengrens op de chips ──────────────────────────────────────────────
//
// "Alles aanvinken levert nul op" is hierboven bewezen. Dat is de STRAF; de
// grens hieronder zorgt dat het niet eens kan. maxFragmentsPerSlot leidt af
// hoeveel fragmenten één track binnen een tab heeft — er staat nergens een 3.
{
	const clip = (nr: number, trackId: string): TabClipData => ({
		id: `c${nr}`,
		tabId: 't1',
		clipId: `cl${nr}`,
		fragmentNumber: nr,
		sortOrder: nr,
		trackId
	});

	// De normale setvorm: 9 clips, 3 tracks, netjes 3 per track.
	const gelijk = [
		clip(1, 'A'),
		clip(4, 'A'),
		clip(7, 'A'),
		clip(2, 'B'),
		clip(5, 'B'),
		clip(8, 'B'),
		clip(3, 'C'),
		clip(6, 'C'),
		clip(9, 'C')
	];
	assert('9 clips over 3 tracks → 3', maxFragmentsPerSlot(gelijk, ['A', 'B', 'C'], 9), 3);

	// Ongelijke groepen: de GROOTSTE wint, want een grens mag geen geldig
	// antwoord tegenhouden. Op de track met 4 moet de speler er 4 kunnen kiezen.
	const ongelijk = [
		clip(1, 'A'),
		clip(2, 'A'),
		clip(3, 'B'),
		clip(4, 'B'),
		clip(5, 'B'),
		clip(6, 'C'),
		clip(7, 'C'),
		clip(8, 'C'),
		clip(9, 'C')
	];
	assert(
		'groepen 2/3/4 → 4, niet het gemiddelde',
		maxFragmentsPerSlot(ongelijk, ['A', 'B', 'C'], 9),
		4
	);

	// Geen enkele clip kent zijn track: niets af te leiden, dus een gelijke
	// verdeling als terugval.
	const zonderTracks = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
		...clip(n, 'A'),
		trackId: undefined
	})) as TabClipData[];
	assert(
		'geen trackId → clips gedeeld door tracks',
		maxFragmentsPerSlot(zonderTracks, ['A', 'B', 'C'], 9),
		3
	);
	assert('terugval rondt naar boven af', maxFragmentsPerSlot(zonderTracks, ['A', 'B'], 9), 5);

	// Geen bron-tracks: geen grens. Dat is ook wat elke variant zonder grouping
	// hier terugkrijgt.
	assert('geen bron-tracks → geen grens', maxFragmentsPerSlot(gelijk, [], 9), 0);

	// Falsificatie: zou de grens ooit 9 worden, dan is alles-aanvinken weer
	// mogelijk en is deze hele sectie zinloos.
	assertTrue(
		'de grens laat alles-aanvinken niet toe',
		maxFragmentsPerSlot(gelijk, ['A', 'B', 'C'], 9) < ALL.length,
		`grens ${maxFragmentsPerSlot(gelijk, ['A', 'B', 'C'], 9)} < ${ALL.length} fragmenten in de tab`
	);
}

// ─── Rapport ────────────────────────────────────────────────────────────────
let failed = 0;
for (const c of checks) {
	if (!c.pass) failed++;
	console.log(`${c.pass ? '✅' : '❌'} ${c.name} — ${c.detail}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
