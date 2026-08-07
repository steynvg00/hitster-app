// verify-chance-modifier.ts — earning laag 4, het TWEEDE eindpunt: de chance-
// modifier op het inverse kanaal (lifeline's echte reddingslijn).
//
// Draaien: npm run bots:verify-chance-modifier
//
// Puur, op sectie E na — die draait awardPowerups tegen de gedeelde recording-fake
// (tests/bots/fake-supabase). Geen database, geen netwerk, geen Playwright.
//
// ── WAT HIER BEWEZEN MOET WORDEN ────────────────────────────────────────────
//
//   A. NEUTRAAL = EXACT. Zonder chance_modifier valt lifeline op precies de
//      draws waarop hij nu valt: de vergelijking is `chance × 1`, en dat is
//      dezelfde float — niet een naburige. Gepind tegen de ONAFHANKELIJKE
//      orakelwaarde 0.5 uit migratie 0071, niet tegen de code zelf.
//   B. HET EINDPUNT WERKT. De factor verschuift de drop-rate ECHT, en dat wordt
//      niet gesteekproefd maar UITGEPUT: met een constante rand() is "valt hij"
//      een functie van de draw, dus over een raster van 10.000 draws is de
//      gemeten rate de exacte rate. Voor elk van de vier team-profielen.
//   C. ZELF-CLAMPING. rand() leeft in [0,1), dus een product ≥ 1 valt altijd en
//      ≤ 0 nooit. Er is geen expliciete clamp, en die is er ook niet nodig —
//      bewezen over het hele raster i.p.v. beweerd in een comment.
//   D. PENALTY_SHOT ONGEMOEID. Met een chance_modifier op lifeline blijft
//      penalty_shot's uitkomst identiek — op elke draw, niet gemiddeld.
//   E. DE GATE-VAL. Een chance_modifier ZONDER weight_modifier moet de assen
//      alsnog laten meten. Zou de gate op het oude predikaat blijven staan, dan
//      blijven beide assen undefined, matcht geen enkele conditie en resolvet de
//      modifier naar een neutrale 1 — een STILLE faal: niets logt, niets errort,
//      en het lijkt exact op een host die niets heeft ingesteld. Hier zowel
//      deterministisch gereconstrueerd als end-to-end door awardPowerups heen.
//   F. DEFENSIEVE RANDEN op het nieuwe eindpunt (de [].every()-val, de
//      ontbrekende as, de kapotte factor).
//   G. ÉÉN EVALUATIE, TWEE EINDPUNTEN. Dezelfde regel geeft dezelfde factor via
//      beide readers — dat is wat de extractie waard maakt.
//
// ── De vacuümval ────────────────────────────────────────────────────────────
// Overgenomen uit verify-safety-net-modifiers.ts: elke bewering over een gebied
// draait OOK tegen een bewust verkeerde verwachting, met de eis dat die ROOD
// wordt (regels gemarkeerd "vacuüm:"). Slaagt de verkeerde variant ook, dan meet
// de test niets en faalt de bot alsnog.
//
// ── ONAFHANKELIJK ORAKEL ────────────────────────────────────────────────────
// De catalogus-feiten hieronder komen uit de MIGRATIES die de types live maakten,
// niet uit powerups.ts (dat is de code onder test):
//   lifeline:      default_inverse=true, default_min/max_score_pct=0/40,
//                  category='defensive', enabled_by_default=true, holdable=true
//                  (supabase/migrations/0071_enable_lifeline.sql:79-92)
//                  ontworpen earn-chance 0.5 (0071:108-126, sectie 3)
//   penalty_shot:  default_inverse=true, default_max_score_pct=40,
//                  category='punishment', enabled_by_default=false
//                  (0057_penalty_shot_live.sql:40-50)

import {
	planAwards,
	awardPowerups,
	resolveChanceModifier,
	resolveWeightModifier,
	resolveModifierFactor,
	hasAnyWeightModifier,
	hasAnyChanceModifier,
	needsSafetyNetAxes,
	LIFELINE_DEFAULT_CHANCE,
	type PlanContext,
	type PowerupType
} from '../../src/lib/server/powerups';
import type { PowerupConfigV2, PowerupTypeOverride, SafetyNetModifier } from '../../src/lib/types';
import { makeFake, opsOn, type Op } from './fake-supabase';

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

// ── De catalogus, uit de migraties (zie de kop) ─────────────────────────────

function makeType(id: string, over: Partial<PowerupType> = {}): PowerupType {
	return {
		id,
		name: id,
		category: 'defensive',
		description: null,
		icon: null,
		enabled_by_default: true,
		coming_soon: false,
		default_min_score_pct: 0,
		default_max_score_pct: 40,
		default_inverse: true,
		immediate_use: false,
		holdable: true,
		sort_order: 1,
		...over
	} as PowerupType;
}

const LIFELINE = makeType('lifeline');
const PENALTY_SHOT = makeType('penalty_shot', {
	category: 'punishment',
	enabled_by_default: false,
	immediate_use: false,
	holdable: false
});

/** De ontworpen drop-rate van lifeline — uit migratie 0071, niet uit de code. */
const DESIGNED_LIFELINE_CHANCE = 0.5;

function cfgWith(types: Record<string, PowerupTypeOverride>): PowerupConfigV2 {
	return {
		version: 2,
		threshold_mode: 'per_challenge',
		band_mode: 'all_bands',
		// Bewust leeg: geen enkele band vuurt, dus alles wat hieronder gemeten wordt
		// komt gegarandeerd uit het INVERSE kanaal en niet uit de ladder.
		thresholds_percent: [],
		types,
		categories: {}
	};
}

// submissionPct 20 zit binnen lifeline's bereik (0-40), dus het type is eligible
// en de enige overgebleven vraag is de chance-roll.
const baseCtx: PlanContext = {
	submissionPct: 20,
	cumulativePct: 0,
	thresholdMode: 'per_challenge',
	bandMode: 'all_bands',
	lastThresholdCrossed: 0
};

// De vier team-profielen, met dezelfde grenzen als de weight-modifier-bot: de
// modifier eist positie ≤ 0.3 (onderste 30% van de stand) EN prestatie ≤ 0.4.
const ctxBehindAndBad: PlanContext = { ...baseCtx, positionPercentile: 0.2, fieldsCorrectFraction: 0.3 };
const ctxBehindOnly: PlanContext = { ...baseCtx, positionPercentile: 0.2, fieldsCorrectFraction: 0.9 };
const ctxBadOnly: PlanContext = { ...baseCtx, positionPercentile: 0.8, fieldsCorrectFraction: 0.3 };
const ctxNeither: PlanContext = { ...baseCtx, positionPercentile: 0.8, fieldsCorrectFraction: 0.9 };
/** De assen zijn NIET gemeten — precies wat een dichte gate oplevert. */
const ctxNoAxes: PlanContext = { ...baseCtx };

const CASES: Array<[string, PlanContext]> = [
	['achter ÉN slecht', ctxBehindAndBad],
	['alleen achter', ctxBehindOnly],
	['alleen slecht', ctxBadOnly],
	['geen van beide', ctxNeither]
];

const AND_MOD: SafetyNetModifier = {
	factor: 2,
	combine: 'and',
	conditions: [
		{ axis: 'position', lte: 0.3 },
		{ axis: 'performance', lte: 0.4 }
	]
};

// ── Het draw-raster ────────────────────────────────────────────────────────
// planAwards is puur met injecteerbare rand. Voeren we een CONSTANTE rand() = d,
// dan is "valt lifeline" precies `d < chance`. Over een raster van 10.000 draws
// is het aantal treffers dus de exacte rate, niet een steekproef ervan — en de
// per-draw-vergelijking hieronder is zelfs een uitputtende equivalentie.
const GRID = 10_000;
const DRAWS = Array.from({ length: GRID }, (_, i) => i / GRID);

function firesOn(cfg: PowerupConfigV2, types: PowerupType[], ctx: PlanContext, typeId: string, d: number): boolean {
	const { awards } = planAwards(cfg, types, ctx, () => d);
	return awards.some((a) => a.typeId === typeId && a.channel === 'inverse');
}

function dropRate(cfg: PowerupConfigV2, types: PowerupType[], ctx: PlanContext, typeId: string): number {
	let fired = 0;
	for (const d of DRAWS) if (firesOn(cfg, types, ctx, typeId, d)) fired++;
	return fired / GRID;
}

/** Valt het type op EXACT de draws waarop een rate van `rate` zou vallen? */
function matchesRateExactly(
	cfg: PowerupConfigV2,
	types: PowerupType[],
	ctx: PlanContext,
	typeId: string,
	rate: number
): boolean {
	return DRAWS.every((d) => firesOn(cfg, types, ctx, typeId, d) === d < rate);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n══ A. Neutraliteit: zonder config valt lifeline exact zoals nu ══\n');
// ════════════════════════════════════════════════════════════════════════════

{
	// De code-constante moet de migratie-seed blijven volgen. Faalt dit, dan is de
	// rest van deze sectie tegen het verkeerde orakel gepind.
	check(
		'LIFELINE_DEFAULT_CHANCE volgt de migratie-seed (0071)',
		LIFELINE_DEFAULT_CHANCE,
		DESIGNED_LIFELINE_CHANCE
	);

	const bare = cfgWith({});
	// Uitputtend, niet één punt: op ELKE draw is de uitkomst die van rate 0.5.
	checkTrue(
		'geen config, geen assen: valt op precies {d < 0.5} over alle 10.000 draws',
		matchesRateExactly(bare, [LIFELINE], ctxNoAxes, 'lifeline', DESIGNED_LIFELINE_CHANCE)
	);
	// En met de assen wél gemeten mag er ook niets veranderen zolang er geen
	// modifier staat — de context alleen mag nooit gedrag verschuiven.
	checkTrue(
		'geen config, assen wél gemeten: identiek, voor alle vier de profielen',
		CASES.every(([, ctx]) =>
			matchesRateExactly(bare, [LIFELINE], ctx, 'lifeline', DESIGNED_LIFELINE_CHANCE)
		)
	);
	check('de gemeten rate is exact 0.5', dropRate(bare, [LIFELINE], ctxBehindAndBad, 'lifeline'), 0.5);

	// Een expliciete host-override blijft ook precies staan.
	checkTrue(
		'expliciete chance 0.3 zonder modifier → precies {d < 0.3}',
		matchesRateExactly(cfgWith({ lifeline: { chance: 0.3 } }), [LIFELINE], ctxBehindAndBad, 'lifeline', 0.3)
	);

	// vacuüm: als de neutrale rate 1.0 was, zou "valt op {d < rate}" triviaal
	// waar zijn voor elk raster en meet bovenstaande niets.
	checkFalsifies(
		'de neutrale rate is niet 1.0',
		dropRate(bare, [LIFELINE], ctxBehindAndBad, 'lifeline') === 1
	);

	// GELIJK RAND-VERBRUIK: de vermenigvuldiging mag geen extra draw kosten, want
	// daar hangt de sequentie-uitlijning van elke gepinde-RNG-test aan.
	const counted = (cfg: PowerupConfigV2, ctx: PlanContext) => {
		let n = 0;
		planAwards(cfg, [LIFELINE, PENALTY_SHOT], ctx, () => {
			n++;
			return 0.9;
		});
		return n;
	};
	const withMod = cfgWith({ penalty_shot: { enabled: true }, lifeline: { chance_modifier: AND_MOD } });
	const without = cfgWith({ penalty_shot: { enabled: true } });
	check(
		'even veel rand()-aanroepen met en zonder modifier',
		[counted(without, ctxBehindAndBad), counted(withMod, ctxBehindAndBad)],
		[2, 2]
	);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n══ B. Het eindpunt werkt: de factor verschuift de drop-rate ══\n');
// ════════════════════════════════════════════════════════════════════════════

{
	const cfg = cfgWith({ lifeline: { chance_modifier: AND_MOD } });

	// Per profiel: de VERWACHTE rate, met de hand uitgerekend uit de regel — niet
	// teruggelezen uit de planner.
	//   achter én slecht → AND matcht → 0.5 × 2 = 1.0
	//   de andere drie   → geen match → 0.5 × 1 = 0.5
	const expected: Array<[string, PlanContext, number]> = [
		['achter ÉN slecht', ctxBehindAndBad, 1.0],
		['alleen achter', ctxBehindOnly, 0.5],
		['alleen slecht', ctxBadOnly, 0.5],
		['geen van beide', ctxNeither, 0.5]
	];
	for (const [label, ctx, rate] of expected) {
		checkTrue(
			`${label}: valt op precies {d < ${rate}} over alle 10.000 draws`,
			matchesRateExactly(cfg, [LIFELINE], ctx, 'lifeline', rate)
		);
	}
	check(
		'gemeten rates per profiel',
		expected.map(([, ctx]) => dropRate(cfg, [LIFELINE], ctx, 'lifeline')),
		[1, 0.5, 0.5, 0.5]
	);

	// Een niet-verzadigend geval, zodat "×2" ook zichtbaar is als een verhouding
	// die niet toevallig op de 1.0-rand landt.
	const cfg30 = cfgWith({ lifeline: { chance: 0.3, chance_modifier: AND_MOD } });
	checkTrue(
		'chance 0.3 × factor 2 = 0.6 exact (geen verzadiging in het spel)',
		matchesRateExactly(cfg30, [LIFELINE], ctxBehindAndBad, 'lifeline', 0.6)
	);
	check(
		'en het team dat niet kwalificeert houdt 0.3',
		dropRate(cfg30, [LIFELINE], ctxNeither, 'lifeline'),
		0.3
	);
	check(
		'de verhouding tussen kwalificeren en niet is precies 2',
		dropRate(cfg30, [LIFELINE], ctxBehindAndBad, 'lifeline') /
			dropRate(cfg30, [LIFELINE], ctxNeither, 'lifeline'),
		2
	);

	// OR i.p.v. AND verandert wie er valt — dezelfde as-machinerie als het
	// gewicht-eindpunt, dus dit moet meebewegen.
	const orCfg = cfgWith({ lifeline: { chance: 0.3, chance_modifier: { ...AND_MOD, combine: 'or' } } });
	check(
		'combine or: drie van de vier profielen krijgen ×2',
		CASES.map(([, ctx]) => dropRate(orCfg, [LIFELINE], ctx, 'lifeline')),
		[0.6, 0.6, 0.6, 0.3]
	);

	// vacuüm 1: de profielen moeten echt uit elkaar liggen.
	checkFalsifies(
		'de vier profielen geven niet allemaal dezelfde rate',
		new Set(expected.map(([, ctx]) => dropRate(cfg, [LIFELINE], ctx, 'lifeline'))).size === 1
	);
	// vacuüm 2: AND en OR moeten een ander profiel geven.
	checkFalsifies(
		'AND en OR geven niet hetzelfde profiel',
		JSON.stringify(CASES.map(([, ctx]) => dropRate(cfg30, [LIFELINE], ctx, 'lifeline'))) ===
			JSON.stringify(CASES.map(([, ctx]) => dropRate(orCfg, [LIFELINE], ctx, 'lifeline')))
	);
	// vacuüm 3: een modifier op het VERKEERDE eindpunt mag hier niets doen — een
	// weight_modifier heeft op dit kanaal geen pool om relatief tegenover te staan.
	checkFalsifies(
		'een weight_modifier op lifeline raakt de drop-rate niet',
		dropRate(cfgWith({ lifeline: { weight_modifier: AND_MOD } }), [LIFELINE], ctxBehindAndBad, 'lifeline') !==
			DESIGNED_LIFELINE_CHANCE
	);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n══ C. Zelf-clamping: het product blijft een kans ══\n');
// ════════════════════════════════════════════════════════════════════════════

{
	// rand() ∈ [0,1), dus een product ≥ 1 valt op ELKE draw en een product ≤ 0 op
	// geen enkele. Er is geen Math.min/Math.max in de code; dit bewijst dat die
	// ook niet nodig is, over het hele raster i.p.v. op de randpunten.
	const big = cfgWith({
		lifeline: { chance_modifier: { factor: 3, conditions: [{ axis: 'position', lte: 0.3 }] } }
	});
	check(
		'chance 0.5 × factor 3 = 1.5 → rate 1.0, niet 1.5',
		dropRate(big, [LIFELINE], ctxBehindAndBad, 'lifeline'),
		1
	);
	checkTrue(
		'en hij valt op ELKE draw in het raster, zonder uitzondering',
		DRAWS.every((d) => firesOn(big, [LIFELINE], ctxBehindAndBad, 'lifeline', d))
	);

	const zero = cfgWith({
		lifeline: { chance_modifier: { factor: 0, conditions: [{ axis: 'position', lte: 0.3 }] } }
	});
	check('factor 0 → rate 0 (geldig: nooit)', dropRate(zero, [LIFELINE], ctxBehindAndBad, 'lifeline'), 0);
	checkTrue(
		'factor 0 raakt alleen wie kwalificeert — de rest houdt 0.5',
		dropRate(zero, [LIFELINE], ctxNeither, 'lifeline') === 0.5
	);

	// De rate blijft over een reeks factoren netjes binnen [0,1] — geen enkele
	// combinatie produceert iets dat geen kans is.
	const rates = [0, 0.5, 1, 2, 5, 100].map((factor) =>
		dropRate(
			cfgWith({ lifeline: { chance_modifier: { factor, conditions: [{ axis: 'position', lte: 0.3 }] } } }),
			[LIFELINE],
			ctxBehindAndBad,
			'lifeline'
		)
	);
	check('factoren 0/0.5/1/2/5/100 → rates blijven kansen', rates, [0, 0.25, 0.5, 1, 1, 1]);
	// vacuüm: zou er niet geclampt worden, dan liep de rate boven 1 uit.
	checkFalsifies('geen enkele rate gaat boven 1', rates.some((r) => r > 1));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n══ D. Penalty_shot blijft ongemoeid ══\n');
// ════════════════════════════════════════════════════════════════════════════

{
	// Beide inverse types in dezelfde pool, penalty_shot aangezet. lifeline krijgt
	// een agressieve modifier; penalty_shot krijgt er geen — dat is de hele
	// scheiding, en hij is per constructie (de config is per type gekeyd).
	//
	// ── Waarom penalty_shot hier chance 0.4 krijgt en niet zijn default 1 ──────
	// Op de default is zijn rate al 1.0, dus VERZADIGD: elke factor ≥ 1 die per
	// ongeluk op hem zou landen is onzichtbaar, en "ongewijzigd" wordt een lege
	// bewering. Dat is geen hypothese — een mutatie die de modifier kanaal-breed
	// maakte (de type-id hardgecodeerd op 'lifeline' in de inverse-lus) kwam op de
	// default ongemerkt door deze sectie heen. Op 0.4 is er ruimte om te schuiven,
	// dus wordt zo'n lek wél zichtbaar: 0.4 × 99 zou tegen de 1.0 aan klappen.
	const types = [LIFELINE, PENALTY_SHOT];
	const PS_CHANCE = 0.4;
	const without = cfgWith({ penalty_shot: { enabled: true, chance: PS_CHANCE } });
	const withMod = cfgWith({
		penalty_shot: { enabled: true, chance: PS_CHANCE },
		lifeline: { chance_modifier: { factor: 99, conditions: [{ axis: 'position', lte: 0.5 }] } }
	});

	// Per draw identiek — niet "gemiddeld hetzelfde".
	checkTrue(
		'penalty_shot: identieke uitkomst op elke draw, met en zonder lifeline-modifier',
		DRAWS.every(
			(d) =>
				firesOn(without, types, ctxBehindAndBad, 'penalty_shot', d) ===
				firesOn(withMod, types, ctxBehindAndBad, 'penalty_shot', d)
		)
	);
	check(
		'penalty_shot houdt zijn eigen rate (0.4), met en zonder lifeline-modifier',
		[
			dropRate(without, types, ctxBehindAndBad, 'penalty_shot'),
			dropRate(withMod, types, ctxBehindAndBad, 'penalty_shot')
		],
		[PS_CHANCE, PS_CHANCE]
	);
	// vacuüm: penalty_shot mag niet verzadigd zijn, anders kan geen enkele factor
	// die per ongeluk op hem landt deze sectie nog rood maken.
	checkFalsifies(
		'penalty_shot zit niet tegen de 1.0 aan (er is ruimte om te schuiven)',
		dropRate(withMod, types, ctxBehindAndBad, 'penalty_shot') === 1
	);
	// En lifeline IS in diezelfde run verschoven — anders vergelijkt bovenstaande
	// twee runs waarin niets gebeurde.
	check(
		'in diezelfde run schoof lifeline wél (0.5 → 1.0)',
		[
			dropRate(without, types, ctxBehindAndBad, 'lifeline'),
			dropRate(withMod, types, ctxBehindAndBad, 'lifeline')
		],
		[0.5, 1]
	);
	// vacuüm: als penalty_shot nooit viel, was "ongewijzigd" een lege bewering.
	checkFalsifies(
		'penalty_shot valt wel degelijk (de controle is niet leeg)',
		dropRate(withMod, types, ctxBehindAndBad, 'penalty_shot') === 0
	);
	// De rate die penalty_shot ZOU krijgen als de modifier kanaal-breed lekte —
	// expliciet uitgerekend, zodat de bewering hierboven een tegenhanger heeft die
	// er meetbaar naast ligt en niet toevallig samenvalt.
	check(
		'een lek zou hem op 1.0 zetten (0.4 × 99), niet op 0.4',
		dropRate(
			cfgWith({
				penalty_shot: {
					enabled: true,
					chance: PS_CHANCE,
					chance_modifier: { factor: 99, conditions: [{ axis: 'position', lte: 0.5 }] }
				}
			}),
			types,
			ctxBehindAndBad,
			'penalty_shot'
		),
		1
	);
	// En de config-scheiding zelf: penalty_shot's factor is 1, wat je ook op
	// lifeline zet.
	check(
		'resolveChanceModifier(penalty_shot) = 1 bij een lifeline-modifier',
		resolveChanceModifier(withMod, 'penalty_shot', ctxBehindAndBad),
		1
	);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n══ E. De gate-val: assen meten bij ALLEEN een chance-modifier ══\n');
// ════════════════════════════════════════════════════════════════════════════

const chanceOnlyCfg = cfgWith({ lifeline: { chance_modifier: AND_MOD } });

{
	// ── De val, deterministisch gereconstrueerd ────────────────────────────────
	// De oude gate vroeg hasAnyWeightModifier. Op deze config is dat FALSE, dus
	// waren beide assen undefined gebleven...
	check('hasAnyWeightModifier op een chance-only config → false', hasAnyWeightModifier(chanceOnlyCfg), false);
	check('hasAnyChanceModifier op diezelfde config → true', hasAnyChanceModifier(chanceOnlyCfg), true);
	check('needsSafetyNetAxes vangt hem wél → true', needsSafetyNetAxes(chanceOnlyCfg), true);

	// ... en dit is wat dat had gekost: zonder assen resolvet de modifier naar een
	// neutrale 1 en ziet de host niets. Geen error, geen log — de stille faal.
	check(
		'assen NIET gemeten → factor 1 (de stille faal die de gate voorkomt)',
		resolveChanceModifier(chanceOnlyCfg, 'lifeline', ctxNoAxes),
		1
	);
	check(
		'assen WEL gemeten → factor 2',
		resolveChanceModifier(chanceOnlyCfg, 'lifeline', ctxBehindAndBad),
		2
	);
	checkTrue(
		'en het verschil is zichtbaar in de rate: 0.5 zonder assen, 1.0 met',
		dropRate(chanceOnlyCfg, [LIFELINE], ctxNoAxes, 'lifeline') === 0.5 &&
			dropRate(chanceOnlyCfg, [LIFELINE], ctxBehindAndBad, 'lifeline') === 1
	);
	// vacuüm: als de gate op het oude predikaat mocht blijven staan, zou
	// hasAnyWeightModifier hier true zijn en bewijst deze sectie niets.
	checkFalsifies('de oude gate zou deze config gemist hebben', hasAnyWeightModifier(chanceOnlyCfg));
}

// ── Door awardPowerups heen: meet de IO-wrapper de assen echt? ──────────────
//
// Bovenstaande bewijst het predikaat; dit bewijst de AANROEPPLEK. awardPowerups
// gebruikt Math.random, dus de uitkomst is niet te pinnen — maar dat hoeft ook
// niet: chance 0.5 × factor 2 = 1.0, en rand() < 1.0 is ALTIJD waar. Een correct
// gegatete wrapper kent dus in 100% van de runs toe; een dichte gate laat de
// factor op 1 en zou op ~50% uitkomen.
{
	const SET_ID = 'set-1';
	const TEAM_ID = 't-red';
	const CHALLENGE_ID = 'c-1';

	// Het team staat laatst (positie 0) en heeft 1 van de 10 velden goed (0.1) —
	// ruim binnen "positie ≤ 0.3 EN prestatie ≤ 0.4".
	const standings = [
		{ id: 't-blue', score: 100 },
		{ id: 't-yellow', score: 80 },
		{ id: TEAM_ID, score: 5 }
	];

	function fakeFor(rawCfg: unknown) {
		return makeFake((op: Op) => {
			if (op.table === 'game_sets') return { powerups_enabled: true, powerup_config: rawCfg };
			if (op.table === 'powerup_types') return [LIFELINE];
			if (op.table === 'set_challenges') return [{ challenge_id: CHALLENGE_ID }];
			if (op.table === 'submissions') return [{ fields_correct: 1, fields_total: 10 }];
			if (op.table === 'team_powerups') return { id: 'tp-1' };
			return null;
		});
	}

	// STRUCTUREEL (deterministisch): worden de assen-queries überhaupt gedaan?
	{
		const { db, log } = fakeFor(chanceOnlyCfg);
		await awardPowerups(db, TEAM_ID, SET_ID, CHALLENGE_ID, 20, undefined, standings);
		checkTrue(
			'chance-only config: de prestatie-as wordt echt opgevraagd (submissions)',
			opsOn(log, 'submissions').length > 0
		);
		checkTrue(
			'... set-gescoped via set_challenges',
			opsOn(log, 'set_challenges').length > 0
		);
		// Geen schema-fout onderweg: de fake keurt elke kolomnaam.
		checkTrue(
			'geen enkele query raakte een niet-bestaande kolom',
			opsOn(log, 'submissions').every((o) => o.cols === 'fields_correct, fields_total')
		);
	}
	// En de tegenhanger: zonder ENIGE modifier blijft de laag gratis.
	{
		const { db, log } = fakeFor(cfgWith({}));
		await awardPowerups(db, TEAM_ID, SET_ID, CHALLENGE_ID, 20, undefined, standings);
		check('zonder modifier: geen assen-query (de laag is gratis)', opsOn(log, 'submissions').length, 0);
	}

	// GEDRAG (end-to-end): 0.5 × 2 = 1.0 → elke run kent toe.
	async function awardCount(rawCfg: unknown, runs: number): Promise<number> {
		let n = 0;
		for (let i = 0; i < runs; i++) {
			const { db } = fakeFor(rawCfg);
			const earned = await awardPowerups(db, TEAM_ID, SET_ID, CHALLENGE_ID, 20, undefined, standings);
			if (earned.some((e) => e.type.id === 'lifeline')) n++;
		}
		return n;
	}

	const RUNS = 60;
	check(
		`chance-modifier actief: lifeline valt in alle ${RUNS} runs (0.5 × 2 = 1.0)`,
		await awardCount(chanceOnlyCfg, RUNS),
		RUNS
	);
	// De controle: zonder modifier is het weer een muntworp, dus strikt tussen 0
	// en RUNS. (Faalt met kans 2^-59 — dat is de prijs voor een echte Math.random
	// end-to-end, en het alternatief is helemaal niet meten.)
	const bareCount = await awardCount(cfgWith({}), RUNS);
	checkTrue(
		`controle zonder modifier: strikt tussen 0 en ${RUNS} (gemeten ${bareCount})`,
		bareCount > 0 && bareCount < RUNS
	);
	// vacuüm: als de wrapper sowieso altijd zou toekennen, bewijst 60/60 niets.
	checkFalsifies('de wrapper kent niet sowieso altijd toe', bareCount === RUNS);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n══ F. Defensieve randen op het nieuwe eindpunt ══\n');
// ════════════════════════════════════════════════════════════════════════════

{
	const f = (mod: unknown, ctx: PlanContext = ctxBehindAndBad): number =>
		resolveChanceModifier(
			cfgWith({ lifeline: { chance_modifier: mod as SafetyNetModifier } }),
			'lifeline',
			ctx
		);

	// De [].every()-val: een lege conditielijst zou met .every() WAAR zijn en dus
	// de drop-rate van ELK team opkrikken — het vangnet voor het hele veld.
	check('lege conditions → ×1 (de [].every()-val)', f({ factor: 2, combine: 'and', conditions: [] }), 1);
	check('conditions ontbreekt → ×1', f({ factor: 2, combine: 'and' }), 1);
	check('conditions is geen array → ×1', f({ factor: 2, conditions: 'nope' }), 1);

	// Onbekend mag nooit het vangnet triggeren.
	check('as ontbreekt in ctx → ×1', f(AND_MOD, ctxNoAxes), 1);
	check('onbekende as-naam → ×1', f({ factor: 2, conditions: [{ axis: 'vibes', lte: 1 }] }), 1);
	check('conditie zonder grens → ×1', f({ factor: 2, conditions: [{ axis: 'position' }] }), 1);
	check('2 condities zonder combine → ×1', f({ factor: 2, conditions: AND_MOD.conditions }), 1);

	// Kapotte factor.
	check('negatieve factor → ×1', f({ factor: -2, conditions: [{ axis: 'position', lte: 0.3 }] }), 1);
	check('factor NaN → ×1', f({ factor: NaN, conditions: [{ axis: 'position', lte: 0.3 }] }), 1);
	check('factor Infinity → ×1', f({ factor: Infinity, conditions: [{ axis: 'position', lte: 0.3 }] }), 1);
	check('chance_modifier is null → ×1', f(null), 1);
	check('chance_modifier is een string → ×1', f('nope'), 1);

	// En elk van die randen moet de RATE ook echt onaangeroerd laten — een factor
	// van 1 die toch iets verschuift is nog steeds kapot.
	const broken: unknown[] = [
		{ factor: 2, combine: 'and', conditions: [] },
		{ factor: -2, conditions: [{ axis: 'position', lte: 0.3 }] },
		{ factor: 2, conditions: [{ axis: 'vibes', lte: 1 }] },
		null,
		'nope'
	];
	checkTrue(
		'elke kapotte vorm laat de rate op precies 0.5',
		broken.every(
			(mod) =>
				dropRate(
					cfgWith({ lifeline: { chance_modifier: mod as SafetyNetModifier } }),
					[LIFELINE],
					ctxBehindAndBad,
					'lifeline'
				) === DESIGNED_LIFELINE_CHANCE
		)
	);
	// vacuüm: een geldige modifier moet in dezelfde meting WEL verschuiven.
	checkFalsifies(
		'een geldige modifier laat de rate niet op 0.5',
		dropRate(cfgWith({ lifeline: { chance_modifier: AND_MOD } }), [LIFELINE], ctxBehindAndBad, 'lifeline') ===
			DESIGNED_LIFELINE_CHANCE
	);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n══ G. Eén evaluatie, twee eindpunten ══\n');
// ════════════════════════════════════════════════════════════════════════════

{
	// Dezelfde regel, via beide readers, over alle profielen én de assenloze ctx:
	// identiek. Dat is precies wat de extractie waard maakt — gaan ze ooit uit
	// elkaar lopen, dan is er een tweede kopie van de and/or-logica ontstaan.
	const allCtx = [...CASES.map(([, c]) => c), ctxNoAxes];
	const rules: SafetyNetModifier[] = [
		AND_MOD,
		{ ...AND_MOD, combine: 'or' },
		{ factor: 3, conditions: [{ axis: 'position', lte: 0.3 }] },
		{ factor: 3, conditions: [{ axis: 'performance', gte: 0.2, lte: 0.4 }] }
	];
	checkTrue(
		'weight- en chance-reader geven dezelfde factor, voor elke regel × elke ctx',
		rules.every((mod) =>
			allCtx.every(
				(ctx) =>
					resolveWeightModifier(cfgWith({ x: { weight_modifier: mod } }), 'x', ctx) ===
					resolveChanceModifier(cfgWith({ x: { chance_modifier: mod } }), 'x', ctx)
			)
		)
	);
	// En beide zijn precies de gedeelde evaluatie — geen van de twee voegt nog
	// iets toe bovenop resolveModifierFactor.
	checkTrue(
		'beide readers zijn niets meer dan resolveModifierFactor + een key',
		rules.every((mod) =>
			allCtx.every(
				(ctx) =>
					resolveModifierFactor(mod, ctx) ===
						resolveChanceModifier(cfgWith({ x: { chance_modifier: mod } }), 'x', ctx) &&
					resolveModifierFactor(mod, ctx) ===
						resolveWeightModifier(cfgWith({ x: { weight_modifier: mod } }), 'x', ctx)
			)
		)
	);
	// De twee keys zijn wél gescheiden: een chance_modifier is geen weight_modifier.
	check(
		'chance_modifier vult het weight-eindpunt NIET',
		resolveWeightModifier(cfgWith({ x: { chance_modifier: AND_MOD } }), 'x', ctxBehindAndBad),
		1
	);
	check(
		'weight_modifier vult het chance-eindpunt NIET',
		resolveChanceModifier(cfgWith({ x: { weight_modifier: AND_MOD } }), 'x', ctxBehindAndBad),
		1
	);
	// vacuüm: de gedeelde evaluatie geeft niet overal 1 — anders is "identiek"
	// een bewering over twee constanten.
	checkFalsifies(
		'de gedeelde evaluatie is niet overal 1',
		rules.every((mod) => allCtx.every((ctx) => resolveModifierFactor(mod, ctx) === 1))
	);
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${failed === 0 ? '✅' : '❌'}  ${passed} geslaagd, ${failed} gefaald\n`);
process.exit(failed === 0 ? 0 : 1);
