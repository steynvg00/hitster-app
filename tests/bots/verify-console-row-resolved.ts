// verify-console-row-resolved.ts — UI-stap 1: de console-row toont RESOLVED waarden.
//
// Draaien: npm run bots:verify-console-row-resolved
//
// Leest de LIVE catalogus (read-only SELECT op powerup_types, zoals
// verify-threshold-range en verify-earning dat ook doen) zodat het bewijs over de
// échte types gaat en niet over een snapshot die stilletjes kan verouderen.
// Verder puur: buildPowerupConsoleRows en alle resolvers zijn pure functies, dus er
// wordt NIETS geschreven.
//
// ── Wat bewezen moet worden ────────────────────────────────────────────────
//
//   A. DE BUG. De oude row-expressies uit +page.server.ts (`override?.chance ?? 1`
//      en vrienden) worden hier als ORAKEL opnieuw geïmplementeerd en vergeleken
//      met de resolvers die de runtime écht gebruikt. Op een VERSE set — geen
//      overrides, precies de toestand van elke set die na migratie 0071 is
//      aangemaakt — moet dat orakel het oneens zijn met de runtime, en wel exact
//      over lifeline: de console zei 100%, de runtime rolt 50%.
//   B. DE FIX. Dezelfde verse set door buildPowerupConsoleRows: lifeline.chance
//      is 0.5, en voor ELK type × ELK veld is row.<veld>.value bit-voor-bit gelijk
//      aan wat de resolver teruggeeft. Dat is de anti-drift-eis — de row mag niet
//      zelf rekenen, hij mag alleen doorgeven.
//   C. OVERRIDE VS DEFAULT. Een geldige override wordt overgenomen en als
//      'override' gemarkeerd; een ONGELDIGE override (die de resolver verwerpt)
//      levert de fallback-waarde én de markering 'invalid' — precies het geval dat
//      voorheen als actieve instelling in de UI stond terwijl de runtime hem negeert.
//   D. DE VANGNET-MODIFIERS reizen mee naar de row, met het juiste endpoint per
//      kanaal (inverse → chance_modifier, ladder → weight_modifier).
//
// ── De vacuümval ────────────────────────────────────────────────────────────
// Blok B is groen zodra row en resolver hetzelfde zeggen — óók als er niets
// vergeleken werd. Daarom telt het bot expliciet hoeveel vergelijkingen het heeft
// gedaan en eist het dat dat aantal klopt met catalogus × velden.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import {
	resolveTypeChance,
	resolveTypeWeight,
	resolveMinScorePct,
	resolveMaxScorePct,
	resolveDiceRange,
	resolveXrayBudget,
	resolveEyeShowScores,
	resolveSpinTierSChance,
	resolveResurrectionScoreMode,
	isInverseChannel,
	parseConfig,
	type PowerupType
} from '../../src/lib/server/powerups';
import { buildPowerupConsoleRows } from '../../src/lib/server/powerup-console';
import type { PowerupTypeOverride, SafetyNetModifier } from '../../src/lib/types';

let passed = 0;
let failed = 0;

function check(name: string, got: unknown, want: unknown) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (ok) passed++;
	else failed++;
	console.log(
		`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`
	);
}
const checkTrue = (name: string, got: boolean) => check(name, got, true);

// ── De live catalogus ────────────────────────────────────────────────────────
const env = Object.fromEntries(
	readFileSync('.env', 'utf8')
		.split('\n')
		.filter((l) => l.includes('=') && !l.trim().startsWith('#'))
		.map((l) => {
			const i = l.indexOf('=');
			return [
				l.slice(0, i).trim(),
				l
					.slice(i + 1)
					.trim()
					.replace(/^["']|["']$/g, '')
			];
		})
);
const db = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: catalogRaw, error } = await db.from('powerup_types').select('*').order('sort_order');
if (error || !catalogRaw?.length) {
	console.log(`Kon de catalogus niet lezen: ${error?.message ?? 'leeg'}`);
	process.exit(1);
}
const catalog = catalogRaw as PowerupType[];

console.log(`\n▶ console-row resolved — tegen ${catalog.length} live catalogus-types\n`);

// Een VERSE set: precies wat `create` in de sets-console wegschrijft. Migratie
// 0033 zet de kolomdefault op deze ene key, en géén set-creatiepad schrijft een
// `types`-subtree — daar komt de bug vandaan.
const FRESH_CONFIG = { thresholds_percent: [25, 50, 75] };

// ─────────────────────────────────────────────────────────────────────────────
console.log('══ A. De bug: het oude row-orakel vs. de runtime ══\n');

{
	const cfg = parseConfig(FRESH_CONFIG);

	/**
	 * Het ORAKEL: de row-expressies zoals ze op main in +page.server.ts:136-138
	 * stonden. Geen resolver in zicht — een rauwe `?? `-keten die de designed
	 * defaults uit DEFAULT_TYPE_CHANCE niet kent.
	 */
	function oldRow(t: PowerupType) {
		const ov = cfg.types[t.id] as PowerupTypeOverride | undefined;
		return {
			chance: ov?.chance ?? 1,
			min: ov?.min_score_pct ?? null,
			max: ov?.max_score_pct ?? null
		};
	}

	const disagreements: { id: string; oud: number; runtime: number }[] = [];
	for (const t of catalog) {
		const oud = oldRow(t).chance;
		const runtime = resolveTypeChance(cfg, t.id);
		if (oud !== runtime) disagreements.push({ id: t.id, oud, runtime });
	}

	check('op een verse set is het oude orakel het EXACT over lifeline oneens', disagreements, [
		{ id: 'lifeline', oud: 1, runtime: 0.5 }
	]);
	checkTrue(
		'de console toonde dus 100% waar de runtime 50% rolt',
		disagreements.some((d) => d.id === 'lifeline' && d.oud * 100 === 100 && d.runtime * 100 === 50)
	);

	// De tweede helft van de bug: de range stond als "override of null" in de row,
	// dus de UI kende de werkelijke grenzen niet — die zitten in de kolommen.
	const lifeline = catalog.find((t) => t.id === 'lifeline');
	if (!lifeline) throw new Error('lifeline ontbreekt in de catalogus');
	check('oude row wist de range niet (null/null)', oldRow(lifeline), {
		chance: 1,
		min: null,
		max: null
	});
	check(
		'terwijl de runtime 0–40 hanteert',
		[resolveMinScorePct(cfg, lifeline), resolveMaxScorePct(cfg, lifeline)],
		[0, 40]
	);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ B. De fix: row.value === resolver, voor elk type en elk veld ══\n');

{
	const cfg = parseConfig(FRESH_CONFIG);
	const rows = buildPowerupConsoleRows(FRESH_CONFIG, catalog);

	check('elk catalogus-type krijgt precies één row', rows.length, catalog.length);

	const lifelineRow = rows.find((r) => r.id === 'lifeline');
	check('lifeline chance.value is de resolved 0.5 (was 1)', lifelineRow?.chance.value, 0.5);
	check('lifeline chance.fallback is óók 0.5', lifelineRow?.chance.fallback, 0.5);
	check(
		'lifeline chance.source is default (niets opgeslagen)',
		lifelineRow?.chance.source,
		'default'
	);
	check(
		'lifeline range komt uit de kolommen',
		[lifelineRow?.min_score_pct.value, lifelineRow?.max_score_pct.value],
		[0, 40]
	);
	check('lifeline is het inverse kanaal', lifelineRow?.is_inverse, true);
	check('lifeline hangt dus aan het chance-endpoint', lifelineRow?.modifier_endpoint, 'chance');

	// De anti-drift-sweep: elk veld van elke row moet gelijk zijn aan wat de
	// resolver zegt. Als de row ooit zelf gaat rekenen, valt dit om.
	let comparisons = 0;
	const drift: string[] = [];
	for (const t of catalog) {
		const row = rows.find((r) => r.id === t.id);
		if (!row) {
			drift.push(`${t.id}: geen row`);
			continue;
		}
		const expect: [string, unknown, unknown][] = [
			['chance', row.chance.value, resolveTypeChance(cfg, t.id)],
			['weight', row.weight.value, resolveTypeWeight(cfg, t.id)],
			['min_score_pct', row.min_score_pct.value, resolveMinScorePct(cfg, t)],
			['max_score_pct', row.max_score_pct.value, resolveMaxScorePct(cfg, t)],
			['is_inverse', row.is_inverse, isInverseChannel(cfg, t)],
			['tier', row.tier, t.tier],
			['holdable', row.holdable, t.holdable],
			['immediate_use', row.immediate_use, t.immediate_use]
		];
		for (const [veld, got, want] of expect) {
			comparisons++;
			if (JSON.stringify(got) !== JSON.stringify(want)) {
				drift.push(`${t.id}.${veld}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
			}
		}
	}
	check('geen enkel veld wijkt af van zijn resolver', drift, []);
	check('en er is echt vergeleken (catalogus × 8 velden)', comparisons, catalog.length * 8);

	// De type-specifieke sterkte-instellingen, elk tegen hun eigen resolver.
	const dice = rows.find((r) => r.id === 'lucky_dice');
	const range = resolveDiceRange(cfg);
	check(
		'lucky_dice dice_min/max volgen resolveDiceRange',
		[dice?.dice_min?.value, dice?.dice_max?.value],
		[range.min, range.max]
	);
	check(
		'x_ray reveal_budget volgt resolveXrayBudget',
		rows.find((r) => r.id === 'x_ray')?.reveal_budget?.value,
		resolveXrayBudget(cfg)
	);
	check(
		'all_seeing_eye show_scores volgt resolveEyeShowScores',
		rows.find((r) => r.id === 'all_seeing_eye')?.show_scores?.value,
		resolveEyeShowScores(cfg)
	);
	check(
		'power_spin tier_s_chance volgt resolveSpinTierSChance',
		rows.find((r) => r.id === 'power_spin')?.tier_s_chance?.value,
		resolveSpinTierSChance(cfg)
	);
	check(
		'resurrection score_mode volgt resolveResurrectionScoreMode',
		rows.find((r) => r.id === 'resurrection')?.score_mode?.value,
		resolveResurrectionScoreMode(cfg)
	);
	// Een type zonder sterkte-dial draagt ze niet — de UI hoeft niet te raden.
	check('shield heeft geen dice-instelling', rows.find((r) => r.id === 'shield')?.dice_min, null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ C. Override vs. default vs. ongeldig ══\n');

{
	// Een set waarin de host wél iets heeft gezet, plus één waarde die de resolver
	// verwerpt (een chance van 3 is geen kans; resolveTypeChance eist finite maar
	// weight < 0 wordt wél verworpen — dus die gebruiken we voor het invalid-geval).
	const configured = {
		thresholds_percent: [50],
		types: {
			shield: { chance: 0.25, weight: 3, min_score_pct: 10, max_score_pct: 90 },
			x_ray: { reveal_budget: 9 },
			// Ongeldig: resolveTypeWeight verwerpt een negatief gewicht en valt terug
			// op de neutrale 1. Voorheen toonde de console hier gewoon "-5".
			insurance: { weight: -5 },
			// Ongeldig: resolveDiceRange verwerpt een omgekeerde range en valt terug op 1–6.
			lucky_dice: { dice_min: 9, dice_max: 2 }
		}
	};
	const rows = buildPowerupConsoleRows(configured, catalog);
	const cfg = parseConfig(configured);

	const shield = rows.find((r) => r.id === 'shield');
	check('shield chance neemt de override over', shield?.chance.value, 0.25);
	check('…en markeert hem als override', shield?.chance.source, 'override');
	check('…met de default als fallback voor de placeholder', shield?.chance.fallback, 1);
	check('shield weight override', [shield?.weight.value, shield?.weight.source], [3, 'override']);
	check(
		'shield range override',
		[shield?.min_score_pct.value, shield?.max_score_pct.value],
		[10, 90]
	);
	check(
		'…en de fallback blijft de catalogus-kolom',
		[shield?.min_score_pct.fallback, shield?.max_score_pct.fallback],
		[
			catalog.find((t) => t.id === 'shield')!.default_min_score_pct,
			catalog.find((t) => t.id === 'shield')!.default_max_score_pct
		]
	);
	check(
		'x_ray reveal_budget override',
		[
			rows.find((r) => r.id === 'x_ray')?.reveal_budget?.value,
			rows.find((r) => r.id === 'x_ray')?.reveal_budget?.source
		],
		[9, 'override']
	);

	const insurance = rows.find((r) => r.id === 'insurance');
	check('ongeldig weight valt terug op de resolver-waarde', insurance?.weight.value, 1);
	check('…en wordt als invalid gemarkeerd, niet als override', insurance?.weight.source, 'invalid');
	checkTrue(
		'…precies wat de runtime doet',
		insurance?.weight.value === resolveTypeWeight(cfg, 'insurance')
	);

	const dice = rows.find((r) => r.id === 'lucky_dice');
	check(
		'omgekeerde dice-range valt terug op 1–6 en heet invalid',
		[dice?.dice_min?.value, dice?.dice_max?.value, dice?.dice_min?.source],
		[1, 6, 'invalid']
	);

	// has_override blijft de badge op de compacte kaart voeden.
	check(
		'has_override blijft kloppen',
		[shield?.has_override, rows.find((r) => r.id === 'free_answer')?.has_override],
		[true, false]
	);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ D. Vangnet-modifiers reizen mee ══\n');

{
	const weightMod: SafetyNetModifier = {
		factor: 2,
		combine: 'and',
		conditions: [
			{ axis: 'position', lte: 0.33 },
			{ axis: 'performance', lte: 0.4 }
		]
	};
	const chanceMod: SafetyNetModifier = {
		factor: 1.5,
		conditions: [{ axis: 'position', lte: 0.25 }]
	};
	const rows = buildPowerupConsoleRows(
		{
			types: {
				shield: { weight_modifier: weightMod },
				lifeline: { chance_modifier: chanceMod }
			}
		},
		catalog
	);

	check(
		'weight_modifier komt ongeschonden mee',
		rows.find((r) => r.id === 'shield')?.weight_modifier,
		weightMod
	);
	check(
		'chance_modifier komt ongeschonden mee',
		rows.find((r) => r.id === 'lifeline')?.chance_modifier,
		chanceMod
	);
	check(
		'een type zonder modifier draagt null',
		rows.find((r) => r.id === 'free_answer')?.weight_modifier,
		null
	);
	check(
		'ladder-type wijst naar het weight-endpoint',
		rows.find((r) => r.id === 'shield')?.modifier_endpoint,
		'weight'
	);
	check(
		'inverse type wijst naar het chance-endpoint',
		rows.find((r) => r.id === 'penalty_shot')?.modifier_endpoint,
		'chance'
	);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} geslaagd, ${failed} gefaald\n`);
process.exit(failed === 0 ? 0 : 1);
