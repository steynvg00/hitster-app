// verify-safety-net-modifiers.ts — earning laag 4: de vangnet-modifiers.
//
// Draaien: npm run bots:verify-safety-net-modifiers
//
// Bijna volledig puur (computePositionPercentile / computeFieldsCorrectFraction /
// resolveWeightModifier / planAwards zijn puur met injecteerbare rand). Sectie A
// draait getSetStandings tegen de gedeelde recording-fake (tests/bots/fake-supabase),
// dus ook deze bot raakt GEEN database en GEEN netwerk.
//
// Wat bewezen moet worden, in volgorde van belangrijkheid:
//
//   A. DE LEADER-FIX. De leider-score is set-gescoped: een achtergebleven score
//      van een kleur die NIET in de set zit telt niet meer mee. Bewezen op de
//      hele toegelaten verzameling — voor ELKE team-score wordt de comeback-
//      uitkomst vergeleken met wat de ongescopete leider zou opleveren — en met
//      de expliciete eis dat er een gebied is waar de twee VERSCHILLEN (anders
//      meet de test niets).
//   B. NEUTRAAL = BIT-IDENTIEK. Zonder weight_modifier-config is de kandidaten-
//      array die planAwards aan weightedPick geeft letterlijk dezelfde als
//      zonder deze laag — dus geldt het bestaande neutraliteitsbewijs
//      (powerups.ts:783-791) onverkort. Gepind tegen de oude uniforme formule
//      als orakel, uitputtend, plus gelijk rand-verbruik.
//   C. DE VIJF GEVALLEN. AND, OR, alleen-positie, alleen-prestatie, geen-config.
//   D. DEFENSIEVE RANDEN. Lege conditions (de [].every()-val), ontbrekende
//      as-waarde, ontbrekende combine bij ≥2 condities, kapotte factor.
//   E. DE ASSEN. Percentiel (inclusief gelijkspel en n=1) en de %-velden-goed-
//      fold (inclusief NULL-rijen en "niets gemeten").
//   F. INTEGRATIE via planAwards: de factor verschuift de verhouding echt, en
//      het inverse-kanaal blijft onaangeraakt.
//
// ── De vacuümval ────────────────────────────────────────────────────────────
// De les uit verify-threshold-range: een bewering die tegen één score wordt
// getoetst is groen bij half-kapotte code. Elke bewering hieronder die over een
// GEBIED gaat wordt daarom over dat hele gebied gedraaid, en elke verhoudings-
// en gebiedstest draait OOK tegen een bewust verkeerde verwachting met de eis
// dat die ROOD wordt (regels gemarkeerd "vacuüm:"). Slaagt de verkeerde variant
// ook, dan meet de test niets en faalt de bot alsnog.

import {
	planAwards,
	resolveTypeWeight,
	resolveWeightModifier,
	computePositionPercentile,
	computeFieldsCorrectFraction,
	hasAnyWeightModifier,
	type PlanContext,
	type PowerupType
} from '../../src/lib/server/powerups';
import { getSetStandings } from '../../src/lib/server/randomize';
import { computeBreakdown, type BonusParams } from '../../src/lib/server/scoring';
import type { PowerupConfigV2, PowerupTypeOverride, SafetyNetModifier } from '../../src/lib/types';
import { makeFake, type Op } from './fake-supabase';

let passed = 0;
let failed = 0;

function check(name: string, got: unknown, want: unknown) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (ok) passed++;
	else failed++;
	console.log(
		`  ${ok ? '✓' : '✗'} ${name}  ${ok ? '' : `→ got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`
	);
}

function checkTrue(name: string, got: boolean) {
	check(name, got, true);
}

/** Een bewering die ROOD hoort te zijn. Groen = de test eromheen meet niets. */
function checkFalsifies(name: string, wrongVariantPasses: boolean) {
	check(`vacuüm: ${name} (verkeerde verwachting faalt)`, wrongVariantPasses, false);
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

/** Een minimale ladder-type-rij; alleen de velden die de planner leest. */
function makeType(id: string, over: Partial<PowerupType> = {}): PowerupType {
	return {
		id,
		name: id,
		category: 'offensive',
		description: null,
		icon: null,
		enabled_by_default: true,
		coming_soon: false,
		default_min_score_pct: 0,
		default_max_score_pct: 100,
		default_inverse: false,
		immediate_use: false,
		holdable: true,
		sort_order: 1,
		...over
	} as PowerupType;
}

const baseCtx: PlanContext = {
	submissionPct: 100,
	cumulativePct: 0,
	thresholdMode: 'per_challenge',
	bandMode: 'all_bands',
	lastThresholdCrossed: 0
};

// ════════════════════════════════════════════════════════════════════════════
console.log('\n══ A. De leader-fix: set-gescopete leider ══\n');
// ════════════════════════════════════════════════════════════════════════════
//
// Het scenario is het echte: een set met team_count = 4 (blue/yellow/green/red).
// De kleuren indigo en black doen NIET mee, maar dragen nog hun totaal uit een
// vorige, grotere set — set-activatie zet alleen de gescopete kleuren op 0
// (src/routes/admin/sets/+page.server.ts:187).

const WORLD_TEAMS = [
	{ id: 't-blue', color: 'blue', score: 40 },
	{ id: 't-yellow', color: 'yellow', score: 30 },
	{ id: 't-green', color: 'green', score: 20 },
	{ id: 't-red', color: 'red', score: 10 },
	// Niet in de set. Achtergebleven totalen uit een vorige set.
	{ id: 't-indigo', color: 'indigo', score: 500 },
	{ id: 't-black', color: 'black', score: 400 }
];

function fakeDbForSet(teamCount: number) {
	return makeFake((op: Op) => {
		if (op.table === 'game_sets') return { team_count: teamCount };
		if (op.table === 'teams') {
			const colors = op.filters.color as string[] | undefined;
			return WORLD_TEAMS.filter((t) => !colors || colors.includes(t.color));
		}
		return null;
	});
}

{
	const { db } = fakeDbForSet(4);
	const standings = await getSetStandings(db, 'set-1');

	check('getSetStandings geeft alleen de 4 gescopete teams, in kleurvolgorde', standings, [
		{ id: 't-blue', score: 40 },
		{ id: 't-yellow', score: 30 },
		{ id: 't-green', score: 20 },
		{ id: 't-red', score: 10 }
	]);

	const scopedLeader = standings.reduce((m, t) => Math.max(m, t.score), 0);
	check('gescopete leider = 40 (niet de achtergebleven 500)', scopedLeader, 40);

	// De ongescopete variant — precies wat submit.ts:213 vóór de fix deed.
	const unscopedLeader = WORLD_TEAMS.reduce((m, t) => Math.max(m, t.score), 0);
	check('ongescopete leider zou 500 zijn geweest', unscopedLeader, 500);

	// Een set met alle 6 de kleuren moet ONVERANDERD blijven: dan is scoped ==
	// unscoped, en de fix mag daar niets verschuiven.
	const { db: db6 } = fakeDbForSet(6);
	const standings6 = await getSetStandings(db6, 'set-1');
	check(
		'team_count = 6 → scoped leider == ongescopete leider (fix verschuift niets)',
		standings6.reduce((m, t) => Math.max(m, t.score), 0),
		unscopedLeader
	);
}

// ── De comeback-uitkomst over de HELE toegelaten verzameling ────────────────
// Niet één score: elke team_score van 0 t/m 520. comeback vuurt als
// team_score < leader_score * 0.5 (scoring.ts:1277).

function comebackFires(teamScore: number, leaderScore: number): boolean {
	const bonus: BonusParams = {
		difficulty_rating: 3,
		challenge_multiplier: 1,
		team_score: teamScore,
		leader_score: leaderScore,
		current_streak: 0,
		streak_thresholds: [],
		elapsed_seconds: null,
		speed_threshold_seconds: null
	};
	return computeBreakdown(10, bonus).comeback_multiplier > 1;
}

{
	const SCOPED = 40;
	const UNSCOPED = 500;

	// Waar de twee lezingen het oneens zijn: scoped zegt "niet achter",
	// ongescoped zegt "wel achter". Dat is precies het over-firing gebied.
	const disagree: number[] = [];
	for (let s = 0; s <= 520; s++) {
		if (comebackFires(s, SCOPED) !== comebackFires(s, UNSCOPED)) disagree.push(s);
	}
	// scoped vuurt bij s < 20, ongescoped bij s < 250 → oneens op [20, 249].
	check(
		'het over-firing gebied is precies [20..249]',
		[disagree[0], disagree[disagree.length - 1], disagree.length],
		[20, 249, 230]
	);

	// DE GERICHTE ASSERT: in dat hele gebied vuurde comeback ten onrechte, en
	// doet dat na de fix niet meer.
	const allWrongBefore = disagree.every((s) => comebackFires(s, UNSCOPED) === true);
	const allRightAfter = disagree.every((s) => comebackFires(s, SCOPED) === false);
	checkTrue('vóór de fix vuurde comeback op ELKE score in dat gebied', allWrongBefore);
	checkTrue('na de fix vuurt comeback op GEEN score in dat gebied', allRightAfter);

	// En buiten het gebied verandert er niets — de fix mag geen echt achterstand-
	// geval wegnemen.
	const outside = [];
	for (let s = 0; s <= 520; s++) if (!disagree.includes(s)) outside.push(s);
	checkTrue(
		'buiten dat gebied is de uitkomst identiek (geen echt achterstandsgeval verdwijnt)',
		outside.every((s) => comebackFires(s, SCOPED) === comebackFires(s, UNSCOPED))
	);

	// vacuüm: als de fix niets deed, zou het oneens-gebied leeg zijn.
	checkFalsifies('het oneens-gebied is niet leeg', disagree.length === 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n══ E. De twee assen ══\n');
// ════════════════════════════════════════════════════════════════════════════

// ── Positie-percentiel ─────────────────────────────────────────────────────
{
	const distinct = [
		{ id: 'a', score: 40 },
		{ id: 'b', score: 30 },
		{ id: 'c', score: 20 },
		{ id: 'd', score: 10 },
		{ id: 'e', score: 0 }
	];
	check('5 teams, unieke scores → leider = 1', computePositionPercentile(distinct, 'a'), 1);
	check('5 teams → 2e = 0.75', computePositionPercentile(distinct, 'b'), 0.75);
	check('5 teams → midden = 0.5', computePositionPercentile(distinct, 'c'), 0.5);
	check('5 teams → 4e = 0.25', computePositionPercentile(distinct, 'd'), 0.25);
	check('5 teams → laatste = 0', computePositionPercentile(distinct, 'e'), 0);

	// Team-count-onafhankelijk: de leider is altijd 1, de laatste altijd 0.
	const ends: Array<[number, number, number]> = [];
	for (let n = 2; n <= 6; n++) {
		const st = Array.from({ length: n }, (_, i) => ({ id: `t${i}`, score: (n - i) * 10 }));
		ends.push([
			n,
			computePositionPercentile(st, 't0')!,
			computePositionPercentile(st, `t${n - 1}`)!
		]);
	}
	checkTrue(
		'voor n = 2..6 is de leider altijd 1 en de laatste altijd 0',
		ends.every(([, first, last]) => first === 1 && last === 0)
	);

	// DE GELIJKSPEL-VAL: bij aanvang staat iedereen op 0. Met "fractie strikt
	// lager" zou iedereen op 0 (= laatste) uitkomen en zou het vangnet voor het
	// hele veld vuren — precies het "iedereen kwalificeert"-probleem, via de
	// gelijkspelregel binnengekomen. Midrank geeft ze allemaal het midden.
	const allTied = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, score: 0 }));
	checkTrue(
		'alles gelijk (spelbegin) → iedereen 0.5, dus GEEN vangnet-trigger',
		allTied.every((t) => computePositionPercentile(allTied, t.id) === 0.5)
	);
	// vacuüm: de naïeve "fractie strikt lager" zou hier 0 geven.
	checkFalsifies(
		'alles-gelijk levert niet 0 op',
		allTied.every((t) => computePositionPercentile(allTied, t.id) === 0)
	);

	// Gedeeltelijk gelijkspel: twee onderaan gelijk in een veld van 5.
	const partial = [
		{ id: 'a', score: 40 },
		{ id: 'b', score: 30 },
		{ id: 'c', score: 20 },
		{ id: 'd', score: 10 },
		{ id: 'e', score: 10 }
	];
	check(
		'twee gelijk onderaan → beide midrank 0.125',
		[computePositionPercentile(partial, 'd'), computePositionPercentile(partial, 'e')],
		[0.125, 0.125]
	);

	// Randen.
	check(
		'n = 1 → 1 (een eenling leidt; vangnet mag niet vuren)',
		computePositionPercentile([{ id: 'a', score: 0 }], 'a'),
		1
	);
	check('leeg veld → undefined', computePositionPercentile([], 'a'), undefined);
	check('team niet in de stand → undefined', computePositionPercentile(distinct, 'zzz'), undefined);
}

// ── %-velden-goed ──────────────────────────────────────────────────────────
{
	check(
		'som/som, niet gemiddelde-van-gemiddelden',
		computeFieldsCorrectFraction([
			{ fields_correct: 1, fields_total: 1 }, // 100% op 1 veld
			{ fields_correct: 1, fields_total: 9 } // 11% op 9 velden
		]),
		0.2 // 2/10 — niet (1.0 + 0.111)/2 = 0.556
	);
	// vacuüm: gemiddelde-van-gemiddelden zou hier ~0.556 geven.
	checkFalsifies(
		'de fold is geen gemiddelde-van-gemiddelden',
		computeFieldsCorrectFraction([
			{ fields_correct: 1, fields_total: 1 },
			{ fields_correct: 1, fields_total: 9 }
		]) === 0.5555555555555556
	);

	check(
		'NULL-rijen (pre-0077) vallen uit teller EN noemer',
		computeFieldsCorrectFraction([
			{ fields_correct: 3, fields_total: 4 },
			{ fields_correct: null, fields_total: null }
		]),
		0.75
	);
	check(
		'een gemeten nul telt WEL mee (0/4 is data, geen ontbreken)',
		computeFieldsCorrectFraction([
			{ fields_correct: 4, fields_total: 4 },
			{ fields_correct: 0, fields_total: 4 }
		]),
		0.5
	);
	check(
		'fields_total = 0 wordt overgeslagen (deel-door-nul)',
		computeFieldsCorrectFraction([{ fields_correct: 0, fields_total: 0 }]),
		undefined
	);
	check('geen rijen → undefined, NIET 0', computeFieldsCorrectFraction([]), undefined);
	check(
		'alleen NULL-rijen → undefined, NIET 0',
		computeFieldsCorrectFraction([{ fields_correct: null, fields_total: null }]),
		undefined
	);
	// Dit is de val die migratie 0077 bij DEFAULT 0 vermeed: "niets gemeten" mag
	// niet lezen als "alles fout", want dan krijgt een team dat nog niet gespeeld
	// heeft het vangnet.
	checkFalsifies('"niets gemeten" is geen 0', computeFieldsCorrectFraction([]) === 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n══ C. De vijf gevallen ══\n');
// ════════════════════════════════════════════════════════════════════════════

const ctxBehindAndBad: PlanContext = {
	...baseCtx,
	positionPercentile: 0.2,
	fieldsCorrectFraction: 0.3
};
const ctxBehindOnly: PlanContext = {
	...baseCtx,
	positionPercentile: 0.2,
	fieldsCorrectFraction: 0.9
};
const ctxBadOnly: PlanContext = { ...baseCtx, positionPercentile: 0.8, fieldsCorrectFraction: 0.3 };
const ctxNeither: PlanContext = { ...baseCtx, positionPercentile: 0.8, fieldsCorrectFraction: 0.9 };

const AND_MOD: SafetyNetModifier = {
	factor: 3,
	combine: 'and',
	conditions: [
		{ axis: 'position', lte: 0.3 },
		{ axis: 'performance', lte: 0.4 }
	]
};
const OR_MOD: SafetyNetModifier = { ...AND_MOD, combine: 'or' };
const POS_ONLY: SafetyNetModifier = { factor: 3, conditions: [{ axis: 'position', lte: 0.3 }] };
const PERF_ONLY: SafetyNetModifier = { factor: 3, conditions: [{ axis: 'performance', lte: 0.4 }] };

const CASES: Array<[string, PlanContext]> = [
	['achter ÉN slecht', ctxBehindAndBad],
	['alleen achter', ctxBehindOnly],
	['alleen slecht', ctxBadOnly],
	['geen van beide', ctxNeither]
];

function factors(mod: SafetyNetModifier | undefined): number[] {
	const cfg = cfgWith({ shield: mod ? { weight_modifier: mod } : {} });
	return CASES.map(([, ctx]) => resolveWeightModifier(cfg, 'shield', ctx));
}

check('AND     → alleen wie aan BEIDE voldoet krijgt ×3', factors(AND_MOD), [3, 1, 1, 1]);
check('OR      → wie aan MINSTENS ÉÉN voldoet krijgt ×3', factors(OR_MOD), [3, 3, 3, 1]);
check('positie → alleen de positie-as telt', factors(POS_ONLY), [3, 3, 1, 1]);
check('prestatie → alleen de prestatie-as telt', factors(PERF_ONLY), [3, 1, 3, 1]);
check('geen config → overal ×1 (neutraal)', factors(undefined), [1, 1, 1, 1]);

// De vier profielen moeten ECHT verschillen — anders bewijst bovenstaande niets.
checkFalsifies(
	'AND en OR geven niet hetzelfde profiel',
	JSON.stringify(factors(AND_MOD)) === JSON.stringify(factors(OR_MOD))
);
checkFalsifies(
	'alleen-positie en alleen-prestatie geven niet hetzelfde profiel',
	JSON.stringify(factors(POS_ONLY)) === JSON.stringify(factors(PERF_ONLY))
);

// Grenzen zijn INCLUSIEF, en over het hele gebied — niet één punt.
{
	const cfg = cfgWith({ shield: { weight_modifier: POS_ONLY } });
	const fires = (p: number) =>
		resolveWeightModifier(cfg, 'shield', { ...baseCtx, positionPercentile: p }) === 3;
	const grid: number[] = [];
	for (let i = 0; i <= 100; i++) grid.push(i / 100);
	checkTrue(
		'lte 0.3 vuurt op precies {p ≤ 0.3} over het hele 0..1 raster',
		grid.every((p) => fires(p) === p <= 0.3 + 1e-9)
	);
	checkTrue('de grens zelf (0.3) telt mee — inclusief', fires(0.3));
	checkFalsifies('de grens is niet exclusief', fires(0.3) === false);

	// gte, en beide grenzen samen (een band).
	const bandCfg = cfgWith({
		shield: {
			weight_modifier: { factor: 2, conditions: [{ axis: 'position', gte: 0.2, lte: 0.6 }] }
		}
	});
	const inBand = (p: number) =>
		resolveWeightModifier(bandCfg, 'shield', { ...baseCtx, positionPercentile: p }) === 2;
	checkTrue(
		'gte+lte = een band, inclusief aan beide kanten, over het hele raster',
		grid.every((p) => inBand(p) === (p >= 0.2 - 1e-9 && p <= 0.6 + 1e-9))
	);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n══ D. Defensieve randen ══\n');
// ════════════════════════════════════════════════════════════════════════════

function f(mod: unknown, ctx: PlanContext = ctxBehindAndBad): number {
	return resolveWeightModifier(
		cfgWith({ shield: { weight_modifier: mod as SafetyNetModifier } }),
		'shield',
		ctx
	);
}

// DE [].every()-VAL: een lege conditielijst zou met .every() WAAR zijn en dus
// ALLES vermenigvuldigen. Expliciet afgevangen.
check(
	'lege conditions → ×1 (de [].every()-val)',
	f({ factor: 3, combine: 'and', conditions: [] }),
	1
);
check('conditions ontbreekt → ×1', f({ factor: 3, combine: 'and' }), 1);
check('conditions is geen array → ×1', f({ factor: 3, conditions: 'nope' }), 1);

// ONBEKEND MAG NOOIT HET VANGNET TRIGGEREN.
check(
	'positie-as ontbreekt in ctx → conditie false → ×1',
	f(POS_ONLY, { ...baseCtx, fieldsCorrectFraction: 0.1 }),
	1
);
check(
	'prestatie-as ontbreekt in ctx → conditie false → ×1',
	f(PERF_ONLY, { ...baseCtx, positionPercentile: 0.1 }),
	1
);
check(
	'OR met één ontbrekende as valt terug op de andere (geen gratis match)',
	f(OR_MOD, { ...baseCtx, positionPercentile: 0.9 }),
	1
);
check(
	'AND met één ontbrekende as → nooit een match',
	f(AND_MOD, { ...baseCtx, positionPercentile: 0.1 }),
	1
);
// vacuüm: als een ontbrekende as als "true" zou lezen, gaf OR hierboven 3.
checkFalsifies(
	'een ontbrekende as leest niet als true',
	f(OR_MOD, { ...baseCtx, positionPercentile: 0.9 }) === 3
);

// combine wordt NIET gedefault bij ≥2 condities — de host kiest.
check(
	'2 condities zonder combine → ×1 (geen stilzwijgende default)',
	f({ factor: 3, conditions: AND_MOD.conditions }),
	1
);
check('1 conditie zonder combine werkt wel (combine kan niet uitmaken)', f(POS_ONLY), 3);
check('onzinnige combine → ×1', f({ ...AND_MOD, combine: 'xor' }), 1);

// Kapotte factor valt terug op neutraal, zelfde vorm als resolveTypeWeight.
check(
	'negatieve factor → ×1 (zou de cumulatieve som corrumperen)',
	f({ ...POS_ONLY, factor: -2 }),
	1
);
check('factor NaN → ×1', f({ ...POS_ONLY, factor: NaN }), 1);
check('factor Infinity → ×1', f({ ...POS_ONLY, factor: Infinity }), 1);
check('factor ontbreekt → ×1', f({ conditions: POS_ONLY.conditions }), 1);
check(
	'factor 0 is GELDIG (nooit getrokken, rest houdt verhouding)',
	f({ ...POS_ONLY, factor: 0 }),
	0
);
check('factor 1 = expliciet neutraal', f({ ...POS_ONLY, factor: 1 }), 1);

// Onzin-vormen.
check('weight_modifier is null → ×1', f(null), 1);
check('weight_modifier is een string → ×1', f('nope'), 1);
check(
	'onbekende as-naam → conditie false → ×1',
	f({ factor: 3, conditions: [{ axis: 'vibes', lte: 1 }] }),
	1
);
check(
	'conditie zonder grens begrenst niets → ×1',
	f({ factor: 3, conditions: [{ axis: 'position' }] }),
	1
);

// De gate die de assen-queries overslaat.
check('hasAnyWeightModifier: leeg → false', hasAnyWeightModifier(cfgWith({})), false);
check(
	'hasAnyWeightModifier: alleen andere overrides → false',
	hasAnyWeightModifier(cfgWith({ shield: { weight: 3 } })),
	false
);
check(
	'hasAnyWeightModifier: één modifier → true',
	hasAnyWeightModifier(cfgWith({ shield: { weight_modifier: POS_ONLY } })),
	true
);

// ════════════════════════════════════════════════════════════════════════════
console.log('\n══ B. Neutraliteit: bit-identiek aan laag 3 ══\n');
// ════════════════════════════════════════════════════════════════════════════
//
// Het bestaande bewijs (powerups.ts:783-791) zegt: met ELK gewicht 1 kiest de
// gewogen trekking exact de index die de oude uniforme pick koos. Dat argument
// gaat alleen over de GEWICHTEN. Deze laag mag ze dus niet aanraken — en dat is
// precies wat hier gepind wordt: het kandidaat-gewicht dat planAwards opbouwt is
// met en zonder deze laag hetzelfde getal.

{
	const cfg = cfgWith({});
	const ids = ['alpha', 'beta', 'gamma', 'shield', 'lucky_dice'];
	// Over alle vijf gevallen uit sectie C plus de "assen onbekend"-ctx: het
	// product resolveTypeWeight × resolveWeightModifier moet ALTIJD gelijk zijn
	// aan resolveTypeWeight alleen.
	const allCtx = [...CASES.map(([, c]) => c), baseCtx];
	const identical = ids.every((id) =>
		allCtx.every(
			(ctx) =>
				resolveTypeWeight(cfg, id) * resolveWeightModifier(cfg, id, ctx) ===
				resolveTypeWeight(cfg, id)
		)
	);
	checkTrue('zonder config: gewicht × modifier === gewicht, voor elk type en elke ctx', identical);

	// Ook met een NIET-neutraal handmatig gewicht (laag 3) moet de modifier het
	// met rust laten — de lagen mogen elkaar niet stilletjes overschrijven.
	const weighted = cfgWith({ alpha: { weight: 7 }, beta: { weight: 0 } });
	checkTrue(
		'zonder modifier-config blijft een handmatig gewicht (7, 0) exact staan',
		allCtx.every(
			(ctx) =>
				resolveTypeWeight(weighted, 'alpha') * resolveWeightModifier(weighted, 'alpha', ctx) ===
					7 &&
				resolveTypeWeight(weighted, 'beta') * resolveWeightModifier(weighted, 'beta', ctx) === 0
		)
	);
}

// ── Gelijke uitkomst én gelijk rand-verbruik via planAwards ────────────────
{
	const poolTypes = [makeType('alpha'), makeType('beta'), makeType('gamma')];
	const cfg = cfgWith({});

	// Het orakel: de oude uniforme pick, exact zoals hij vóór laag 3 stond.
	function oldUniformPlan(rand: () => number): string[] {
		const out: string[] = [];
		const rolled = poolTypes.filter(() => rand() < 1);
		if (rolled.length) out.push(rolled[Math.floor(rand() * rolled.length)].id);
		return out;
	}

	let sameAward = 0;
	let sameCalls = 0;
	const SEEDS = 400;
	for (let seed = 1; seed <= SEEDS; seed++) {
		let a = 0;
		const randA = ((r) => () => (a++, r()))(lcg(seed));
		const got = planAwards(
			cfg,
			poolTypes,
			{ ...baseCtx, positionPercentile: 0.1, fieldsCorrectFraction: 0.1 },
			randA
		);

		let b = 0;
		const randB = ((r) => () => (b++, r()))(lcg(seed));
		const want = oldUniformPlan(randB);

		if (JSON.stringify(got.awards.map((x) => x.typeId)) === JSON.stringify(want)) sameAward++;
		if (a === b) sameCalls++;
	}
	check(`over ${SEEDS} seeds: zelfde award als de oude uniforme pick`, sameAward, SEEDS);
	check(`over ${SEEDS} seeds: zelfde aantal rand()-aanroepen`, sameCalls, SEEDS);
	// vacuüm: als de assen-ctx het gedrag zou beïnvloeden zonder config, zou dit
	// niet 400/400 zijn.
	checkFalsifies('de uitkomst is niet toevallig gelijk', sameAward !== SEEDS);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n══ F. Integratie via planAwards ══\n');
// ════════════════════════════════════════════════════════════════════════════

{
	const poolTypes = [makeType('alpha'), makeType('beta')];

	// alpha krijgt ×3 als het team achterloopt ÉN slecht speelt; beta niet.
	const cfg = cfgWith({ alpha: { weight_modifier: AND_MOD } });

	function ratio(ctx: PlanContext, seedBase: number): number {
		let alpha = 0;
		let beta = 0;
		for (let s = 1; s <= 4000; s++) {
			const { awards } = planAwards(cfg, poolTypes, ctx, lcg(seedBase + s));
			for (const a of awards) {
				if (a.typeId === 'alpha') alpha++;
				if (a.typeId === 'beta') beta++;
			}
		}
		return alpha / Math.max(1, beta);
	}

	const rBoth = ratio(ctxBehindAndBad, 10_000);
	const rNeither = ratio(ctxNeither, 10_000);

	checkTrue(
		`team dat aan BEIDE voldoet: alpha:beta ≈ 3:1 (gemeten ${rBoth.toFixed(2)})`,
		rBoth > 2.6 && rBoth < 3.4
	);
	checkTrue(
		`team dat aan GEEN voldoet: alpha:beta ≈ 1:1 (gemeten ${rNeither.toFixed(2)})`,
		rNeither > 0.85 && rNeither < 1.18
	);
	// vacuüm: de twee verhoudingen moeten echt uit elkaar liggen, anders meet de
	// marge niets.
	checkFalsifies('de twee verhoudingen liggen niet in elkaars marge', rBoth < 1.18);
	checkFalsifies('de neutrale verhouding haalt de 3:1-marge niet', rNeither > 2.6);
}

// ── Het inverse-kanaal blijft onaangeraakt ─────────────────────────────────
{
	// lifeline-achtig: inverse, dus geen pool en geen weightedPick
	// (powerups.ts:1045-1052). Een gewicht-modifier heeft daar niets om relatief
	// tegenover te staan en mag de uitkomst niet verschuiven.
	const inv = makeType('lifeline', { default_inverse: true, default_max_score_pct: 40 });
	const ctxIn: PlanContext = {
		...baseCtx,
		submissionPct: 20,
		positionPercentile: 0.1,
		fieldsCorrectFraction: 0.1
	};

	const without = cfgWith({});
	const withMod = cfgWith({
		lifeline: { weight_modifier: { factor: 99, conditions: [{ axis: 'position', lte: 0.5 }] } }
	});

	let same = 0;
	for (let seed = 1; seed <= 300; seed++) {
		const a = planAwards(without, [inv], ctxIn, lcg(seed)).awards;
		const b = planAwards(withMod, [inv], ctxIn, lcg(seed)).awards;
		if (JSON.stringify(a) === JSON.stringify(b)) same++;
	}
	check('inverse-kanaal: factor 99 verandert niets, over 300 seeds', same, 300);
	// En het kanaal doet wél iets — anders vergelijkt bovenstaande twee lege lijsten.
	checkTrue(
		'de inverse-controle is niet leeg (het kanaal kent wél toe)',
		planAwards(without, [inv], ctxIn, () => 0).awards.length === 1
	);
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${failed === 0 ? '✅' : '❌'}  ${passed} geslaagd, ${failed} gefaald\n`);
process.exit(failed === 0 ? 0 : 1);
