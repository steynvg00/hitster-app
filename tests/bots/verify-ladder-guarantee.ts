// verify-ladder-guarantee.ts — de ladder-garantie: gekwalificeerd = ALTIJD een powerup.
//
// Puur en in-memory (planAwards is puur met injecteerbare rand), plus één
// optionele pas tegen de ECHTE catalogus als er een .env met Supabase-sleutels
// ligt. Draaien: npm run bots:verify-ladder-guarantee
//
// ── De regel die hier gepind wordt ──────────────────────────────────────────
// KWALIFICEREN IS DE POOL. Valt de score van een team binnen de range van
// minstens één ladder-type, dan levert elke gevuurde band een powerup op. Valt
// hij binnen géén enkele range, dan levert hij niets op. Er is geen derde
// uitkomst waarin een gekwalificeerd team met lege handen wegloopt omdat een
// muntje verkeerd viel.
//
// Vóór LADDER_CHANCE bestond die derde uitkomst wel: elk pool-type rolde eerst
// `rand() < resolveTypeChance(...)`, en vielen ze allemaal om, dan sloeg de band
// stil over. Bij de standaardwaarden gebeurde dat nooit (elk ladder-type staat
// op 1), maar een set waarin een host ooit een chance had ingesteld — en de
// console kón dat schrijven — bleef die trekkingen verliezen.
//
// ── Wat hier bewezen wordt, in volgorde van belangrijkheid ──────────────────
//   A. DE GARANTIE. Niet-lege pool + gevuurde band ⇒ evenveel awards als bands,
//      uitputtend over elke score 0..100 × vele seeds. Nul tegenvoorbeelden.
//   B. OPGESLAGEN CHANCE IS DOOD. Exact dezelfde uitkomst met `chance: 0` op elk
//      ladder-type in de config. Dit is de eigenlijke fix, en de test die ROOD
//      wordt zodra iemand de call-site terugdraait naar resolveTypeChance.
//   C. GEEN FALLBACK. Een lege pool blijft leeg: de garantie is "de pool betaalt
//      altijd", niet "elke band betaalt altijd". Een score onder elke type-min
//      hoort niets op te leveren.
//   D. INVERSE ONGEMOEID. Het andere kanaal beslist nog exact volgens
//      `rand() < chance × modifier`: lifeline op zijn ontworpen 0.5,
//      penalty_shot op 1, en de vangnet-modifier buigt lifeline nog steeds.
//   E. RAND-BUDGET ONGEWIJZIGD. Nog steeds één draw per pool-type plus één per
//      trekking, zodat elke gepinde-RNG-volgorde elders uitgelijnd blijft.
//
// ── De vacuümval ────────────────────────────────────────────────────────────
// "Er is altijd een award" is triviaal groen als de opzet nooit een band laat
// vuren. Elke bewering hieronder draait daarom naast een controle die ROOD moet
// zijn (regels gemarkeerd "vacuüm:"), zodat een test die niets meet alsnog faalt.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
	planAwards,
	scoreInRange,
	resolveTypeChance,
	LADDER_CHANCE,
	LIFELINE_DEFAULT_CHANCE,
	type PlanContext,
	type PowerupType
} from '../../src/lib/server/powerups';
import type { PowerupConfigV2, PowerupTypeOverride } from '../../src/lib/types';

let passed = 0;
let failed = 0;

function check(name: string, got: unknown, want: unknown) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	// if/else rather than the sibling bots' `ok ? passed++ : failed++` — same
	// thing, minus the no-unused-expressions error eslint raises on that form.
	if (ok) passed++;
	else failed++;
	console.log(
		`  ${ok ? '✓' : '✗'} ${name}  ${ok ? '' : `→ got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`
	);
}

function checkTrue(name: string, got: boolean) {
	check(name, got, true);
}

/** Deterministische PRNG (LCG, Numerical Recipes) — elke run identiek. */
function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (1664525 * s + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

const THRESHOLDS = [25, 50, 75];

function cfgWith(
	types: Record<string, PowerupTypeOverride>,
	over: Partial<PowerupConfigV2> = {}
): PowerupConfigV2 {
	return {
		version: 2,
		threshold_mode: 'per_challenge',
		band_mode: 'all_bands',
		thresholds_percent: THRESHOLDS,
		types,
		categories: {},
		...over
	};
}

const mkType = (
	id: string,
	min: number,
	max: number,
	extra: Partial<PowerupType> = {}
): PowerupType =>
	({
		id,
		name: id,
		category: 'self',
		coming_soon: false,
		enabled_by_default: true,
		default_inverse: false,
		default_min_score_pct: min,
		default_max_score_pct: max,
		...extra
	}) as unknown as PowerupType;

// De synthetische catalogus: drie ladder-types met oplopende ondergrenzen, plus
// een inverse type dat onderaan leeft. De laagste ladder-min (50) ligt hier
// BEWUST boven de laagste band (25), zodat er een lege pool te meten valt (sectie
// C). De echte catalogus heeft die zone momenteel NIET — double_down staat op
// 0–100% — en juist daarom is dit een synthetische opzet: de garantie moet ook
// gelden voor een catalogus waarin gaten wél voorkomen, en die kan morgen
// terugkomen zodra een host een min verhoogt. Sectie F draait dezelfde regel over
// de catalogus zoals die vandaag echt is.
const LADDER = [mkType('alpha', 50, 100), mkType('beta', 70, 100), mkType('gamma', 90, 100)];
const INVERSE = mkType('lifeline', 0, 40, { category: 'defensive', default_inverse: true });
const CATALOG = [...LADDER, INVERSE];

function baseCtx(submissionPct: number): PlanContext {
	return {
		submissionPct,
		cumulativePct: 0,
		thresholdMode: 'per_challenge',
		bandMode: 'all_bands',
		lastThresholdCrossed: 0
	};
}

/** Het orakel, onafhankelijk van planAwards: hoeveel ladder-awards HOREN er te vallen. */
function expectedLadderAwards(cfg: PowerupConfigV2, score: number): number {
	const poolSize = LADDER.filter((t) => scoreInRange(cfg, t, score)).length;
	const bands = THRESHOLDS.filter((t) => t <= score).length;
	return poolSize > 0 ? bands : 0;
}

const ladderCount = (awards: { channel: string }[]) =>
	awards.filter((a) => a.channel === 'ladder').length;

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ A. De garantie: niet-lege pool + gevuurde band ⇒ altijd een award ══\n');

{
	const cfg = cfgWith({});
	const rand = lcg(20260812);
	let comparisons = 0;
	let mismatches = 0;
	let qualifyingDraws = 0;
	const firstFew: string[] = [];

	for (let score = 0; score <= 100; score++) {
		for (let seed = 0; seed < 40; seed++) {
			const want = expectedLadderAwards(cfg, score);
			const got = ladderCount(planAwards(cfg, CATALOG, baseCtx(score), rand).awards);
			comparisons++;
			if (want > 0) qualifyingDraws++;
			if (got !== want) {
				mismatches++;
				if (firstFew.length < 3) firstFew.push(`score=${score} got=${got} want=${want}`);
			}
		}
	}
	for (const f of firstFew) console.log(`      ${f}`);
	check(
		`uitputtend score 0..100 × 40 seeds: 0 afwijkingen (${comparisons} vergelijkingen)`,
		mismatches,
		0
	);
	checkTrue(
		`vacuüm: er zijn écht kwalificerende trekkingen gemeten (${qualifyingDraws} > 1000)`,
		qualifyingDraws > 1000
	);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ B. Een opgeslagen chance-override is DOOD op de ladder ══\n');

{
	// De kern van de fix. Deze config zegt letterlijk "val nooit" voor elk
	// ladder-type; onder de oude call-site leverde hij nul awards op.
	const starved = cfgWith({
		alpha: { chance: 0 },
		beta: { chance: 0 },
		gamma: { chance: 0 }
	});

	// Eerst: de config zégt het ook echt. Zonder deze regel zou B groen kunnen
	// staan omdat de override nooit is aangekomen in plaats van omdat hij wordt
	// genegeerd.
	check(
		'de override staat er en resolveTypeChance leest hem nog steeds als 0',
		resolveTypeChance(starved, 'alpha'),
		0
	);
	check('LADDER_CHANCE is de constante die de call-site in plaats daarvan leest', LADDER_CHANCE, 1);

	const rand = lcg(777);
	let mismatches = 0;
	for (let score = 0; score <= 100; score++) {
		for (let seed = 0; seed < 25; seed++) {
			const want = expectedLadderAwards(starved, score);
			const got = ladderCount(planAwards(starved, CATALOG, baseCtx(score), rand).awards);
			if (got !== want) mismatches++;
		}
	}
	check('chance=0 op elk ladder-type verandert NIETS aan de uitkomst', mismatches, 0);

	// En bit-identiek aan de config zonder overrides, op dezelfde seed-reeks.
	const withOverride: number[] = [];
	const without: number[] = [];
	const r1 = lcg(31337);
	const r2 = lcg(31337);
	for (let i = 0; i < 500; i++) {
		withOverride.push(ladderCount(planAwards(starved, CATALOG, baseCtx(100), r1).awards));
		without.push(ladderCount(planAwards(cfgWith({}), CATALOG, baseCtx(100), r2).awards));
	}
	check('zelfde seed, met én zonder override: identieke reeks', withOverride, without);
	checkTrue(
		'vacuüm: die reeks is niet leeg',
		withOverride.every((n) => n === 3)
	);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ C. Geen fallback: een lege pool blijft leeg ══\n');

{
	const cfg = cfgWith({});
	const rand = lcg(4242);
	let awardsInDeadZone = 0;
	let bandsFiredInDeadZone = 0;

	// 25..49: band 25 vuurt, maar geen enkel ladder-type heeft hier een range.
	for (let score = 25; score <= 49; score++) {
		for (let seed = 0; seed < 40; seed++) {
			awardsInDeadZone += ladderCount(planAwards(cfg, CATALOG, baseCtx(score), rand).awards);
		}
		bandsFiredInDeadZone += THRESHOLDS.filter((t) => t <= score).length;
	}
	check(
		'score 25–49%: nul ladder-awards (niet gekwalificeerd, geen fallback)',
		awardsInDeadZone,
		0
	);
	checkTrue(
		`vacuüm: er vuurden hier wel degelijk bands (${bandsFiredInDeadZone} > 0) — de nul komt van de lege pool, niet van stilte`,
		bandsFiredInDeadZone > 0
	);

	// En direct boven de grens slaat het om, wat bewijst dat C en A elkaar niet
	// overlappen: dezelfde catalogus, één procentpunt hoger, wél een award.
	const at50 = ladderCount(planAwards(cfg, CATALOG, baseCtx(50), lcg(1)).awards);
	check('score 50%: twee bands (25, 50) × niet-lege pool = 2 awards', at50, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ D. Het inverse kanaal is ONGEMOEID ══\n');

{
	// Score 20: onder elke ladder-min én onder elke band, dus de ladder-lus
	// verbruikt geen enkele rand() en de eerste draw is die van lifeline.
	const inverseOnly = [INVERSE];
	const cfg = cfgWith({});

	let mismatches = 0;
	const draws: number[] = [];
	for (let k = 0; k <= 200; k++) draws.push(k / 200 - (k === 200 ? 1e-12 : 0));

	for (const d of draws) {
		const { awards } = planAwards(cfg, inverseOnly, baseCtx(20), () => d);
		const fired = awards.some((a) => a.typeId === 'lifeline' && a.channel === 'inverse');
		// Het orakel is de regel zelf, met de ECHTE constante.
		if (fired !== d < LIFELINE_DEFAULT_CHANCE) mismatches++;
	}
	check(
		`lifeline vuurt exact bij draw < ${LIFELINE_DEFAULT_CHANCE}, over 201 draws`,
		mismatches,
		0
	);
	check('LIFELINE_DEFAULT_CHANCE is nog steeds de ontworpen 0.5', LIFELINE_DEFAULT_CHANCE, 0.5);

	// Vacuüm: de test zou een verschoven drempel merken.
	let wrongOracle = 0;
	for (const d of draws) {
		const { awards } = planAwards(cfg, inverseOnly, baseCtx(20), () => d);
		const fired = awards.some((a) => a.typeId === 'lifeline');
		if (fired !== d < 1) wrongOracle++;
	}
	checkTrue(
		`vacuüm: een orakel van 1.0 wijkt wél af (${wrongOracle} afwijkingen > 0)`,
		wrongOracle > 0
	);

	// penalty_shot: geen designed default, dus rate 1 — vuurt altijd in range.
	const penalty = mkType('penalty_shot', 0, 40, {
		category: 'punishment',
		default_inverse: true,
		enabled_by_default: false
	});
	const penaltyCfg = cfgWith({ penalty_shot: { enabled: true } });
	let penaltyFires = 0;
	for (const d of draws) {
		const { awards } = planAwards(penaltyCfg, [penalty], baseCtx(20), () => d);
		if (awards.some((a) => a.typeId === 'penalty_shot')) penaltyFires++;
	}
	check('penalty_shot vuurt bij elke draw in range (rate 1)', penaltyFires, draws.length);

	// De vangnet-modifier buigt lifeline nog steeds: factor 2 × 0.5 = 1.
	const netCfg = cfgWith({
		lifeline: {
			chance_modifier: { factor: 2, conditions: [{ axis: 'position', lte: 0.34 }] }
		}
	});
	const ctxBehind: PlanContext = { ...baseCtx(20), positionPercentile: 0.1 };
	const ctxAhead: PlanContext = { ...baseCtx(20), positionPercentile: 0.9 };
	let behindFires = 0;
	let aheadFires = 0;
	for (const d of draws) {
		if (planAwards(netCfg, inverseOnly, ctxBehind, () => d).awards.length) behindFires++;
		if (planAwards(netCfg, inverseOnly, ctxAhead, () => d).awards.length) aheadFires++;
	}
	check('vangnet actief (×2): lifeline vuurt bij elke draw', behindFires, draws.length);
	checkTrue(
		`vangnet inactief: lifeline vuurt op ongeveer de helft (${aheadFires} van ${draws.length})`,
		aheadFires > 0 && aheadFires < draws.length
	);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ E. Het rand-budget is ongewijzigd ══\n');

{
	// Twee pool-types, twee gevuurde bands (25 en 50 bij score 60) ⇒ per band één
	// draw per pool-type plus één trekking = 2 × (2 + 1) = 6.
	let calls = 0;
	const counting = () => {
		calls++;
		return 0.5;
	};
	const twoTypes = [mkType('alpha', 0, 100), mkType('beta', 0, 100)];
	planAwards(cfgWith({}), twoTypes, baseCtx(60), counting);
	check('2 pool-types × 2 bands: 4 chance-rolls + 2 trekkingen = 6 rand-aanroepen', calls, 6);

	// Een lege pool verbruikt niets — filter over nul kandidaten, geen trekking.
	calls = 0;
	planAwards(cfgWith({}), [mkType('alpha', 90, 100)], baseCtx(60), counting);
	check('lege pool: 0 rand-aanroepen', calls, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// F. De ECHTE catalogus. Read-only SELECT; overgeslagen zonder Supabase-sleutels.
// ─────────────────────────────────────────────────────────────────────────────
async function verifyRealCatalog() {
	console.log('\n══ F. Dezelfde garantie tegen de ECHTE catalogus ══\n');

	try {
		const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
		for (const line of raw.split('\n')) {
			const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
			if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
		}
	} catch {
		/* geen .env — dan hieronder de skip */
	}

	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		console.log('  … overgeslagen (geen Supabase-sleutels) — A–E zijn puur en dekken de regel\n');
		return;
	}

	const db = createClient(url, key);
	const { data, error } = await db.from('powerup_types').select('*').order('sort_order');
	if (error || !data?.length) {
		console.log(`  … overgeslagen (catalogus niet leesbaar: ${error?.message ?? 'leeg'})\n`);
		return;
	}

	const types = data as PowerupType[];
	const cfg = cfgWith({});
	const ladderTypes = types.filter(
		(t) => !t.coming_soon && t.enabled_by_default && !t.default_inverse
	);
	const mins = ladderTypes.map((t) => t.default_min_score_pct).sort((a, b) => a - b);
	console.log(
		`      ${types.length} types, ${ladderTypes.length} op de ladder, laagste type-min ${mins[0]}%, laagste band ${Math.min(...THRESHOLDS)}%`
	);

	const rand = lcg(90210);
	let mismatches = 0;
	let qualifying = 0;
	for (let score = 0; score <= 100; score++) {
		const poolSize = ladderTypes.filter((t) => scoreInRange(cfg, t, score)).length;
		const bands = THRESHOLDS.filter((t) => t <= score).length;
		const want = poolSize > 0 ? bands : 0;
		if (want > 0) qualifying++;
		for (let seed = 0; seed < 25; seed++) {
			if (ladderCount(planAwards(cfg, types, baseCtx(score), rand).awards) !== want) mismatches++;
		}
	}
	check('echte catalogus, score 0..100 × 25 seeds: 0 afwijkingen', mismatches, 0);
	checkTrue(`vacuüm: er kwalificeren echt scores (${qualifying} van 101)`, qualifying > 10);

	// Informatief, geen bewering: waar lopen band-ladder en pool uiteen? Dit is het
	// materiaal voor de threshold↔range-validatie (bouwstap 3), niet voor deze.
	const laagsteBand = Math.min(...THRESHOLDS);
	if (mins[0] > laagsteBand) {
		console.log(
			`      dode zone ${laagsteBand}–${mins[0] - 1}%: band vuurt, pool leeg — onder "kwalificeren is de pool" hoort daar niets te vallen`
		);
	} else if (mins[0] < laagsteBand) {
		console.log(
			`      GEEN dode zone (laagste type-min ${mins[0]}% ligt onder de laagste band ${laagsteBand}%).`
		);
		console.log(
			`      Wel het spiegelbeeld: 0–${laagsteBand - 1}% zit al in een pool maar haalt geen enkele band, dus levert niets op.`
		);
	} else {
		console.log(`      Band-ladder en pool sluiten exact aan op ${laagsteBand}%.`);
	}
}

verifyRealCatalog()
	.catch((e) => {
		console.log(`  ✗ F wierp een fout: ${e instanceof Error ? e.message : String(e)}`);
		failed++;
	})
	.finally(() => {
		console.log(
			`\n${failed === 0 ? 'GROEN' : 'ROOD'}: ${passed}/${passed + failed} checks geslaagd\n`
		);
		process.exit(failed === 0 ? 0 : 1);
	});
