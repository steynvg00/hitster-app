// verify-weighted-lottery.ts — earning laag 3: de gewogen loterij.
//
// Pure, in-memory: weightedPick / resolveTypeWeight / planAwards zijn allemaal
// puur met injecteerbare rand (src/lib/server/powerups.ts), dus deze bot raakt
// GEEN database en GEEN netwerk. Draaien: npm run bots:verify-weighted-lottery
//
// Wat bewezen moet worden, in volgorde van belangrijkheid:
//
//   A. NEUTRAAL = BIT-IDENTIEK. Met elk gewicht 1 moet de gewogen trekking
//      exact dezelfde index kiezen als de oude uniforme pick
//      `rolled[Math.floor(rand() * rolled.length)]`. Niet "statistisch gelijk" —
//      letterlijk dezelfde index, voor elke lijstlengte en elke trekking. Dat
//      wordt hier UITPUTTEND gepind tegen de oude formule als orakel, niet
//      beredeneerd.
//   B. ZWAARDER WINT VAKER. Gewicht 3 tegen 1 moet ~3:1 opleveren.
//   C. RANDGEVALLEN. Lege lijst, één kandidaat, alles-nul, een enkele nul
//      tussen positieven, en ongeldige gewichten via resolveTypeWeight.
//   D. INTEGRATIE. Via planAwards: rand-verbruik ongewijzigd (één trekking per
//      band, net als voorheen) en de verhouding verschuift echt mee.
//
// ── De vacuümval ────────────────────────────────────────────────────────────
// Een verhoudingstest die "ongeveer 3:1" toelaat met een ruime marge is groen
// bij ELKE verdeling als de marge te ruim staat — dan meet hij niks. Daarom
// draait elke verhoudingsbewering hieronder OOK tegen een bewust verkeerde
// verwachting, met de eis dat die ROOD wordt. Slaagt de verkeerde variant ook,
// dan meet de test niets en faalt de bot alsnog (regels gemarkeerd "vacuüm:").

import {
	weightedPick,
	resolveTypeWeight,
	planAwards,
	DEFAULT_TYPE_WEIGHT,
	type PlanContext
} from '../../src/lib/server/powerups';
import type { PowerupConfigV2, PowerupTypeOverride } from '../../src/lib/types';

let passed = 0;
let failed = 0;

function check(name: string, got: unknown, want: unknown) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	ok ? passed++ : failed++;
	console.log(`  ${ok ? '✓' : '✗'} ${name}  ${ok ? '' : `→ got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

function checkTrue(name: string, got: boolean) {
	check(name, got, true);
}

// Deterministische PRNG (LCG, Numerical Recipes) — geen Math.random, zodat elke
// run identiek is en een rode test reproduceerbaar blijft.
function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (1664525 * s + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function cfgWith(types: Record<string, PowerupTypeOverride>): PowerupConfigV2 {
	return {
		version: 2,
		threshold_mode: 'per_challenge',
		band_mode: 'all_bands',
		thresholds_percent: [50],
		types,
		categories: {}
	};
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ A. Neutrale gewichten zijn BIT-IDENTIEK aan de oude uniforme pick ══\n');

// Het orakel: exact de regel die vervangen is (powerups.ts, oude r806).
const oldUniformIndex = (r: number, n: number) => Math.floor(r * n);

{
	// Uitputtend: elke lijstlengte 1..8 × 201 trekkingen verspreid over [0,1),
	// inclusief de randen 0, 0.5 en net-onder-1 waar floor() en de cumulatieve
	// som uiteen zouden kunnen lopen.
	const draws: number[] = [];
	for (let k = 0; k <= 200; k++) draws.push(k / 200 - (k === 200 ? 1e-12 : 0));
	draws.push(0, 0.5, 0.25, 0.75, 1 - Number.EPSILON);

	let mismatches = 0;
	let comparisons = 0;
	for (let n = 1; n <= 8; n++) {
		const items = Array.from({ length: n }, (_, i) => `t${i}`);
		const candidates = items.map((item) => ({ item, weight: DEFAULT_TYPE_WEIGHT }));
		for (const r of draws) {
			const got = weightedPick(candidates, () => r);
			const want = items[oldUniformIndex(r, n)];
			comparisons++;
			if (got !== want) {
				mismatches++;
				if (mismatches <= 3) console.log(`      n=${n} r=${r} got=${got} want=${want}`);
			}
		}
	}
	check(`uitputtend n=1..8 × ${draws.length} trekkingen: 0 afwijkingen`, mismatches, 0);
	checkTrue(`vacuüm: er is echt vergeleken (${comparisons} vergelijkingen > 1000)`, comparisons > 1000);

	// Vacuüm-controle op het orakel zelf: als de gewichten NIET neutraal zijn moet
	// dezelfde vergelijking juist wél afwijken. Anders zou test A ook groen zijn
	// bij een pick die de gewichten volledig negeert.
	const skewed = [
		{ item: 't0', weight: 9 },
		{ item: 't1', weight: 1 }
	];
	const skewedDiffers = weightedPick(skewed, () => 0.7) !== ['t0', 't1'][oldUniformIndex(0.7, 2)];
	checkTrue('vacuüm: scheve gewichten wijken juist WEL af van de uniforme formule', skewedDiffers);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ B. Zwaarder gewicht wint aantoonbaar vaker ══\n');

function drawCounts(
	candidates: { item: string; weight: number }[],
	n: number,
	seed = 12345
): Record<string, number> {
	const rand = lcg(seed);
	const counts: Record<string, number> = {};
	for (const c of candidates) counts[c.item] = 0;
	for (let i = 0; i < n; i++) {
		const pick = weightedPick(candidates, rand);
		if (pick) counts[pick]++;
	}
	return counts;
}

{
	const N = 60_000;
	const counts = drawCounts(
		[
			{ item: 'heavy', weight: 3 },
			{ item: 'light', weight: 1 }
		],
		N
	);
	const ratio = counts.heavy / counts.light;
	console.log(`      heavy=${counts.heavy} light=${counts.light} ratio=${ratio.toFixed(3)} (verwacht ≈3.000)`);

	const near3 = Math.abs(ratio - 3) < 0.08;
	checkTrue('gewicht 3 vs 1 levert ≈3:1', near3);

	// vacuüm: dezelfde marge tegen een VERKEERDE verwachting moet rood zijn.
	checkTrue('vacuüm: dezelfde marge verwerpt 1:1', !(Math.abs(ratio - 1) < 0.08));
	checkTrue('vacuüm: dezelfde marge verwerpt 5:1', !(Math.abs(ratio - 5) < 0.08));

	// Drie ongelijke gewichten — bewijst dat het niet toevallig op 2 kandidaten past.
	const c3 = drawCounts(
		[
			{ item: 'a', weight: 6 },
			{ item: 'b', weight: 3 },
			{ item: 'c', weight: 1 }
		],
		N
	);
	const share = (k: string) => c3[k] / N;
	console.log(
		`      a=${share('a').toFixed(3)} b=${share('b').toFixed(3)} c=${share('c').toFixed(3)} (verwacht 0.600 / 0.300 / 0.100)`
	);
	checkTrue(
		'6:3:1 levert ≈0.6/0.3/0.1',
		Math.abs(share('a') - 0.6) < 0.01 &&
			Math.abs(share('b') - 0.3) < 0.01 &&
			Math.abs(share('c') - 0.1) < 0.01
	);
	checkTrue('vacuüm: dezelfde marge verwerpt een uniforme 1/3-verdeling', !(Math.abs(share('a') - 1 / 3) < 0.01));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ C. Randgevallen ══\n');

check('lege lijst → null', weightedPick([], () => 0.5), null);
check('één kandidaat → altijd die (r=0)', weightedPick([{ item: 'solo', weight: 1 }], () => 0), 'solo');
check(
	'één kandidaat → altijd die (r≈1)',
	weightedPick([{ item: 'solo', weight: 1 }], () => 1 - Number.EPSILON),
	'solo'
);
check(
	'één kandidaat met gewicht 0 → nog steeds die (uniforme terugval)',
	weightedPick([{ item: 'solo', weight: 0 }], () => 0.5),
	'solo'
);

{
	// Alles nul → uniforme terugval, NIET null (een verkeerd getypte config mag
	// niet als een avond pech lezen).
	const counts = drawCounts(
		[
			{ item: 'a', weight: 0 },
			{ item: 'b', weight: 0 }
		],
		20_000
	);
	console.log(`      alles-nul: a=${counts.a} b=${counts.b}`);
	checkTrue('alles gewicht 0 → beide kandidaten komen voor (uniform)', counts.a > 0 && counts.b > 0);
	checkTrue('alles gewicht 0 → ≈50/50', Math.abs(counts.a / counts.b - 1) < 0.08);
	checkTrue('vacuüm: die marge verwerpt een 3:1-verdeling', !(Math.abs(3 - 1) < 0.08));
}

{
	// Eén nul tussen positieven: nooit getrokken, de rest houdt z'n verhouding.
	const counts = drawCounts(
		[
			{ item: 'zero', weight: 0 },
			{ item: 'x', weight: 2 },
			{ item: 'y', weight: 1 }
		],
		30_000
	);
	console.log(`      zero=${counts.zero} x=${counts.x} y=${counts.y}`);
	check('gewicht 0 tussen positieven wordt NOOIT getrokken', counts.zero, 0);
	checkTrue('de overige twee houden hun 2:1', Math.abs(counts.x / counts.y - 2) < 0.08);
}

console.log('');
{
	// resolveTypeWeight: de config-leeskant.
	const c = cfgWith({
		set3: { weight: 3 },
		zero: { weight: 0 },
		neg: { weight: -5 },
		nan: { weight: Number.NaN },
		inf: { weight: Number.POSITIVE_INFINITY },
		other: { enabled: true }
	});
	check('handmatig gezette weight 3 wordt gelezen', resolveTypeWeight(c, 'set3'), 3);
	check('expliciete 0 blijft 0 (geldige instelling)', resolveTypeWeight(c, 'zero'), 0);
	check('negatief → neutrale 1', resolveTypeWeight(c, 'neg'), 1);
	check('NaN → neutrale 1', resolveTypeWeight(c, 'nan'), 1);
	check('Infinity → neutrale 1', resolveTypeWeight(c, 'inf'), 1);
	check('type met andere overrides maar geen weight → 1', resolveTypeWeight(c, 'other'), 1);
	check('type zonder enkele override → 1', resolveTypeWeight(c, 'afwezig'), 1);
	check('lege config → 1', resolveTypeWeight(cfgWith({}), 'wat-dan-ook'), 1);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ D. Integratie via planAwards ══\n');

const mkType = (id: string) => ({
	id,
	name: id,
	category: 'self',
	coming_soon: false,
	enabled_by_default: true,
	default_inverse: false,
	default_min_score_pct: 0,
	default_max_score_pct: 100
});
const poolTypes = [mkType('alpha'), mkType('beta')] as never[];

const ctx: PlanContext = {
	submissionPct: 100,
	cumulativePct: 0,
	thresholdMode: 'per_challenge',
	bandMode: 'all_bands',
	lastThresholdCrossed: 0
};

{
	// rand-verbruik: één chance-roll per pool-type + één trekking = 3 aanroepen
	// bij een pool van 2 en één band. Dat is precies wat de oude uniforme pick
	// ook verbruikte — een extra trekking zou elke gepinde rand-reeks in de
	// bestaande earn-bots verschuiven.
	let calls = 0;
	const counting = () => {
		calls++;
		return 0;
	};
	const { awards } = planAwards(cfgWith({}), poolTypes, ctx, counting);
	check('planAwards verbruikt 2 chance-rolls + 1 trekking = 3 rand-aanroepen', calls, 3);
	check('en levert één ladder-award', awards.length, 1);
	check('rand=0 kiest de eerste kandidaat (zoals floor(0*n)=0)', awards[0].typeId, 'alpha');
}

{
	// Neutraal via planAwards: over veel seeds ≈50/50 tussen twee pool-types.
	const N = 40_000;
	const counts: Record<string, number> = { alpha: 0, beta: 0 };
	const rand = lcg(999);
	for (let i = 0; i < N; i++) {
		const { awards } = planAwards(cfgWith({}), poolTypes, ctx, rand);
		for (const a of awards) counts[a.typeId]++;
	}
	console.log(`      neutraal: alpha=${counts.alpha} beta=${counts.beta}`);
	checkTrue('neutrale gewichten → ≈50/50 (ongewijzigd gedrag)', Math.abs(counts.alpha / counts.beta - 1) < 0.06);
	checkTrue('vacuüm: die marge verwerpt 3:1', !(Math.abs(3 - 1) < 0.06));
}

{
	// Gewogen via planAwards: alpha 3, beta 1 → ≈3:1. Bewijst dat de weight-read
	// écht in de earn-keten zit en niet alleen in de helper.
	const N = 40_000;
	const counts: Record<string, number> = { alpha: 0, beta: 0 };
	const rand = lcg(999);
	const weighted = cfgWith({ alpha: { weight: 3 }, beta: { weight: 1 } });
	for (let i = 0; i < N; i++) {
		const { awards } = planAwards(weighted, poolTypes, ctx, rand);
		for (const a of awards) counts[a.typeId]++;
	}
	const ratio = counts.alpha / counts.beta;
	console.log(`      gewogen: alpha=${counts.alpha} beta=${counts.beta} ratio=${ratio.toFixed(3)}`);
	checkTrue('weight 3 vs 1 in powerup_config → ≈3:1 in de earn-keten', Math.abs(ratio - 3) < 0.1);
	checkTrue('vacuüm: dezelfde marge verwerpt de neutrale 1:1', !(Math.abs(ratio - 1) < 0.1));

	// chance is ONGEMOEID: een gewicht mag de drop-rate niet raken. Beide configs
	// leveren evenveel awards — alleen de verdeling verschilt.
	const total = counts.alpha + counts.beta;
	check('gewogen run levert evenveel awards als er bands vuurden (drop-rate onveranderd)', total, N);
}

{
	// weight 0 in de config: dat type valt uit de trekking, de rest neemt het over
	// — maar de band levert nog stééds een award (drop-rate is chance, niet weight).
	const N = 5_000;
	const counts: Record<string, number> = { alpha: 0, beta: 0 };
	const rand = lcg(4242);
	const zeroed = cfgWith({ alpha: { weight: 0 }, beta: { weight: 1 } });
	for (let i = 0; i < N; i++) {
		const { awards } = planAwards(zeroed, poolTypes, ctx, rand);
		for (const a of awards) counts[a.typeId]++;
	}
	console.log(`      alpha weight 0: alpha=${counts.alpha} beta=${counts.beta}`);
	check('weight 0 → dat type valt nooit', counts.alpha, 0);
	check('maar de band levert nog steeds een award (chance ongemoeid)', counts.beta, N);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? 'GROEN' : 'ROOD'}: ${passed}/${passed + failed} checks geslaagd\n`);
process.exit(failed === 0 ? 0 : 1);
