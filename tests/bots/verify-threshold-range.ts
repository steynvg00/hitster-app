// verify-threshold-range.ts — earning laag 1: de score-range en de ontwarring.
//
// Draaien: npm run bots:verify-threshold-range
//
// Leest de LIVE catalogus (read-only SELECT op powerup_types, zoals verify-earning
// dat ook doet) zodat het bewijs over de échte types gaat en niet over een
// snapshot die stilletjes kan verouderen. Verder puur: planAwards / scoreInRange
// zijn pure functies met injecteerbare rand, dus er wordt niets geschreven.
//
// ── Wat bewezen moet worden ────────────────────────────────────────────────
//
//   A. HET ENIGE VERSCHIL. De oude, betekenis-afhankelijke logica wordt hier
//      opnieuw geïmplementeerd als ORAKEL en regel voor regel vergeleken met de
//      nieuwe scoreInRange — over elk type in de catalogus × elke score. De
//      verzameling meningsverschillen moet EXACT {(lifeline,40), (penalty_shot,40)}
//      zijn. Niet "ongeveer", niet "alleen wat we controleerden": de exacte set.
//   B. Dat 40%-randgeval end-to-end door planAwards (de bewust bijgewerkte assert).
//   C. Een override van min én max verschuift de eligibiliteit correct.
//      (range 10-40: 5%→nee, 10%→ja, 40%→ja, 41%→nee)
//   D. Een INVERSE type met een ondergrens: 0% valt buiten range 10-40, 39% erin.
//      Dit is de nieuwe uitdrukkingskracht — "miste de challenge" ≠ "speelde slecht".
//   E. Validatie: ongeldige overrides vallen terug op de kolom; een omgekeerde
//      range (min > max) laat niets toe.
//
// ── De vacuümval ────────────────────────────────────────────────────────────
// Blok A is groen zodra de twee predikaten hetzelfde zeggen — óók als beide
// stuk zijn, of als er niets vergeleken werd. Daarom telt het bot expliciet
// hoeveel vergelijkingen er zijn gedaan, eist het dat het verwachte verschil er
// ECHT is (40% moet bij inverse verschillen, anders is de bewuste wijziging niet
// eens doorgevoerd), en draaien C/D ook tegen verschoven grenzen die rood moeten
// worden.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import {
	planAwards,
	scoreInRange,
	isInverseChannel,
	resolveMinScorePct,
	resolveMaxScorePct,
	type PlanContext,
	type PowerupType
} from '../../src/lib/server/powerups';
import type { PowerupConfigV2, PowerupTypeOverride } from '../../src/lib/types';

let passed = 0;
let failed = 0;

function check(name: string, got: unknown, want: unknown) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	ok ? passed++ : failed++;
	console.log(
		`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`
	);
}
const checkTrue = (name: string, got: boolean) => check(name, got, true);

function cfgWith(types: Record<string, PowerupTypeOverride>): PowerupConfigV2 {
	return {
		version: 2,
		threshold_mode: 'per_challenge',
		band_mode: 'all_bands',
		thresholds_percent: [],
		types,
		categories: {}
	};
}

// ── De live catalogus ────────────────────────────────────────────────────────
const env = Object.fromEntries(
	readFileSync('.env', 'utf8')
		.split('\n')
		.filter((l) => l.includes('=') && !l.trim().startsWith('#'))
		.map((l) => {
			const i = l.indexOf('=');
			return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
		})
);
const db = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: catalogRaw, error } = await db.from('powerup_types').select('*').order('sort_order');
if (error || !catalogRaw?.length) {
	console.log(`Kon de catalogus niet lezen: ${error?.message ?? 'leeg'}`);
	process.exit(1);
}
const catalog = catalogRaw as PowerupType[];

console.log(`\n▶ laag 1 — score-range, tegen ${catalog.length} live catalogus-types\n`);

// ─────────────────────────────────────────────────────────────────────────────
console.log('══ A. Het ENIGE verschil met de oude logica ══\n');

/**
 * Het ORAKEL: de logica zoals die op main stond, letterlijk overgenomen.
 *   pool   (powerups.ts r906-908):  !inverse && pct >= (ov.threshold ?? min_col) && pct <= max_col
 *   invers (powerups.ts r939-940):   inverse && pct <  (ov.threshold ?? max_col)
 * Zonder overrides — en die zijn er live nul — reduceert dat tot de kolommen.
 */
function oldScoreEligible(t: PowerupType, pct: number): boolean {
	if (!t.default_inverse) {
		return pct >= t.default_min_score_pct && pct <= t.default_max_score_pct;
	}
	return pct < t.default_max_score_pct; // strikt, en géén ondergrens
}

{
	const emptyCfg = cfgWith({});
	// Elke hele score 0..100, plus fijne stappen rond elke voorkomende grens.
	const scores = new Set<number>();
	for (let p = 0; p <= 100; p++) scores.add(p);
	for (const t of catalog) {
		for (const b of [t.default_min_score_pct, t.default_max_score_pct]) {
			for (const d of [-1, -0.5, -0.1, -0.01, 0, 0.01, 0.1, 0.5, 1]) {
				const v = b + d;
				if (v >= 0 && v <= 100) scores.add(Number(v.toFixed(2)));
			}
		}
	}
	const scoreList = [...scores].sort((a, b) => a - b);

	const diffs: { id: string; pct: number; old: boolean; nw: boolean }[] = [];
	let comparisons = 0;
	for (const t of catalog) {
		for (const pct of scoreList) {
			const o = oldScoreEligible(t, pct);
			const n = scoreInRange(emptyCfg, t, pct);
			comparisons++;
			if (o !== n) diffs.push({ id: t.id, pct, old: o, nw: n });
		}
	}

	console.log(`      ${comparisons} vergelijkingen (${catalog.length} types × ${scoreList.length} scores)`);
	for (const d of diffs) console.log(`      Δ ${d.id} @ ${d.pct}%: oud=${d.old} nieuw=${d.nw}`);

	const diffKeys = diffs.map((d) => `${d.id}@${d.pct}`).sort();
	check('het verschil is EXACT lifeline@40 + penalty_shot@40', diffKeys, [
		'lifeline@40',
		'penalty_shot@40'
	]);
	checkTrue('en in beide gevallen is nieuw=true (de grens telt nu mee)', diffs.every((d) => d.nw && !d.old));

	// vacuüm: is er wel écht iets vergeleken, en zou een gelijk-blijvend predikaat
	// betrapt worden?
	checkTrue(`vacuüm: er is substantieel vergeleken (${comparisons} > 2000)`, comparisons > 2000);
	checkTrue(
		'vacuüm: het orakel en het nieuwe predikaat zijn NIET dezelfde functie (er is een echt verschil gevonden)',
		diffs.length > 0
	);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ B. Het 40%-randgeval end-to-end door planAwards ══\n');

const ctx: PlanContext = {
	submissionPct: 0,
	cumulativePct: 0,
	thresholdMode: 'per_challenge',
	bandMode: 'all_bands',
	lastThresholdCrossed: 0
};
const inverseTypes = catalog.filter((t) => t.default_inverse);
check('de catalogus heeft precies 2 inverse types', inverseTypes.map((t) => t.id).sort(), [
	'lifeline',
	'penalty_shot'
]);

{
	const cfg = cfgWith({ penalty_shot: { enabled: true, chance: 1 }, lifeline: { chance: 1 } });
	const at = (pct: number) =>
		planAwards(cfg, inverseTypes, { ...ctx, submissionPct: pct }, () => 0).awards.length;
	check('39% vuurt beide (ongewijzigd)', at(39), 2);
	check('40% vuurt nu beide (was 0 — de bewuste wijziging)', at(40), 2);
	check('41% vuurt niets (ongewijzigd)', at(41), 0);
	check('0% vuurt beide (geen ondergrens in de catalogus)', at(0), 2);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ C. Override van min én max verschuift de eligibiliteit ══\n');

const normalType = catalog.find((t) => !t.default_inverse && !t.coming_soon)!;
{
	const ranged = cfgWith({ [normalType.id]: { min_score_pct: 10, max_score_pct: 40 } });
	const inR = (pct: number) => scoreInRange(ranged, normalType, pct);
	console.log(`      type: ${normalType.id} (kolom ${normalType.default_min_score_pct}-${normalType.default_max_score_pct}) → override 10-40`);
	check('5% valt buiten (onder de min)', inR(5), false);
	check('10% valt erin (min is inclusief)', inR(10), true);
	check('25% valt erin', inR(25), true);
	check('40% valt erin (max is inclusief)', inR(40), true);
	check('41% valt buiten (boven de max)', inR(41), false);

	check('de override wordt echt gelezen — min', resolveMinScorePct(ranged, normalType), 10);
	check('de override wordt echt gelezen — max', resolveMaxScorePct(ranged, normalType), 40);

	// vacuüm: de override moet de eligibiliteit ECHT verschuiven. Niet op één
	// gekozen score getest (41% valt bij shield's kolomrange 60-100 óók al buiten,
	// dus dáár verschillen ze toevallig niet), maar over het hele bereik: de
	// verzameling toegelaten scores moet aantoonbaar anders zijn.
	const bare = cfgWith({});
	const allScores = Array.from({ length: 101 }, (_, p) => p);
	const bareIn = allScores.filter((p) => scoreInRange(bare, normalType, p));
	const rangedIn = allScores.filter((p) => inR(p));
	console.log(`      kolom laat ${bareIn.length} scores toe, override laat er ${rangedIn.length} toe`);
	checkTrue(
		'vacuüm: de override verschuift de toegelaten scores echt',
		JSON.stringify(bareIn) !== JSON.stringify(rangedIn)
	);
	check('de override laat precies 10..40 toe (31 scores)', rangedIn.length, 31);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ D. Een INVERSE type met een ONDERgrens (nieuwe uitdrukkingskracht) ══\n');

{
	const lifeline = catalog.find((t) => t.id === 'lifeline')!;
	const floored = cfgWith({ lifeline: { chance: 1, min_score_pct: 10, max_score_pct: 40 } });
	const fire = (pct: number) =>
		planAwards(floored, [lifeline], { ...ctx, submissionPct: pct }, () => 0).awards.length;

	check('0% ("miste de challenge") valt nu BUITEN range 10-40', fire(0), 0);
	check('9% valt buiten', fire(9), 0);
	check('10% valt erin', fire(10), 1);
	check('39% ("speelde slecht") valt erin', fire(39), 1);
	check('40% valt erin', fire(40), 1);
	check('41% valt buiten', fire(41), 0);

	// vacuüm: zonder ondergrens vuurt 0% wél — dus de ondergrens is wat het verschil maakt.
	const noFloor = cfgWith({ lifeline: { chance: 1 } });
	check(
		'vacuüm: zonder ondergrens vuurt 0% wél (de ondergrens is echt wat 0% uitsluit)',
		planAwards(noFloor, [lifeline], { ...ctx, submissionPct: 0 }, () => 0).awards.length,
		1
	);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ E. Validatie en degeneratie ══\n');

{
	const t = normalType;
	const bad = (o: PowerupTypeOverride) => cfgWith({ [t.id]: o });
	check('min = -5 → terug naar de kolom', resolveMinScorePct(bad({ min_score_pct: -5 }), t), t.default_min_score_pct);
	check('min = 150 → terug naar de kolom', resolveMinScorePct(bad({ min_score_pct: 150 }), t), t.default_min_score_pct);
	check('min = NaN → terug naar de kolom', resolveMinScorePct(bad({ min_score_pct: Number.NaN }), t), t.default_min_score_pct);
	check('max = 150 → terug naar de kolom', resolveMaxScorePct(bad({ max_score_pct: 150 }), t), t.default_max_score_pct);
	check('geen override → de kolom', resolveMinScorePct(cfgWith({}), t), t.default_min_score_pct);
	check('min = 0 is een GELDIGE override', resolveMinScorePct(bad({ min_score_pct: 0 }), t), 0);
	check('max = 0 is een GELDIGE override', resolveMaxScorePct(bad({ max_score_pct: 0 }), t), 0);

	// Omgekeerde range laat niets toe — een tegenspraak wordt niet stilzwijgend omgedraaid.
	const inverted = cfgWith({ [t.id]: { min_score_pct: 60, max_score_pct: 40 } });
	checkTrue(
		'omgekeerde range (60-40) laat NIETS toe, op geen enkele score',
		Array.from({ length: 101 }, (_, p) => p).every((p) => !scoreInRange(inverted, t, p))
	);
}

{
	// inverse is nu PUUR een kanaal-label: het zegt niets meer over grenzen.
	const c = cfgWith({});
	const lifeline = catalog.find((t) => t.id === 'lifeline')!;
	checkTrue('isInverseChannel(lifeline) = true', isInverseChannel(c, lifeline));
	checkTrue('isInverseChannel(een normaal type) = false', !isInverseChannel(c, normalType));
	// Zelfde range-override, zelfde antwoord — ongeacht het kanaal.
	const r = { min_score_pct: 20, max_score_pct: 60 };
	const cInv = cfgWith({ lifeline: r, [normalType.id]: r });
	checkTrue(
		'dezelfde range geeft hetzelfde antwoord voor een inverse én een normaal type',
		[0, 19, 20, 40, 60, 61, 100].every(
			(p) => scoreInRange(cInv, lifeline, p) === scoreInRange(cInv, normalType, p)
		)
	);
}

console.log(`\n${failed === 0 ? 'GROEN' : 'ROOD'}: ${passed}/${passed + failed} checks geslaagd\n`);
process.exit(failed === 0 ? 0 : 1);
