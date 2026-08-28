// Fase 1b, step 2 — the earning GAP: lifeline + penalty_shot's inverse channel.
// Plus (R1 gap 4): the category switch's POSITIVE control — see
// verifyCategorySwitch() below for why that cannot live in the live harness.
//
//   npm run bots:verify-earning-inverse
//
// PURE-FUNCTION harness — NO app, NO DB, NO Playwright, NO mutation. planAwards
// (src/lib/server/powerups.ts:619-675) is a pure planner: (cfg, types, ctx, rand)
// in, {awards, newHighwater} out. No live-DB run (à la verify-earning.ts) is
// needed to close this gap — the planner itself is the thing under test.
//
// ── THE GAP ────────────────────────────────────────────────────────────────
// verify-earning.ts explicitly filters BOTH types out of its awardable pool:
//
//   .filter((t) => t.enabled_by_default && !t.coming_soon && !t.default_inverse)
//                                                             ^^^^^^^^^^^^^^^^^^
//   (verify-earning.ts:105)
//
// — because lifeline and penalty_shot are default_inverse=true: earned on a LOW
// score via planAwards' INVERSE channel (powerups.ts:661-672), not the normal
// ladder that pool exists to sweep. Nothing else exercises that channel for
// either type; this file closes exactly that gap.
//
// ── INDEPENDENT ORACLE ────────────────────────────────────────────────────
// The catalog facts asserted against below are read from the MIGRATIONS that
// made each type live — not from powerups.ts, which is the code under test:
//   lifeline:      default_inverse=true, default_max_score_pct=40,
//                  category='defensive', enabled_by_default=true, holdable=true
//                  (supabase/migrations/0071_enable_lifeline.sql:79-92)
//   penalty_shot:  default_inverse=true, default_max_score_pct=40,
//                  category='punishment' (0056_powerup_types_coming_soon.sql:50),
//                  enabled_by_default=false, immediate_use=true, holdable=false
//                  (0057_penalty_shot_live.sql:40-50)
//
// SCOPE-EERLIJKHEID (same posture as verify-activation-self-defensive.ts): this
// proves the PLANNER decides correctly given these catalog facts. It does not
// prove awardPowerups' IO wrapper around the planner writes the right DB rows —
// that is the same class of proof verify-earning.ts already gives the NORMAL
// channel, just not (yet) re-run for the inverse one end-to-end.

import { planAwards, type PlanContext } from '../../src/lib/server/powerups';
import { makeAsserter } from './fake-supabase';

const { checks, assert } = makeAsserter();

async function verifyInverseEarning() {
	console.log('\n── earning gap: lifeline + penalty_shot, the INVERSE channel ──────');

	const lifelineType = {
		id: 'lifeline',
		category: 'defensive',
		coming_soon: false,
		enabled_by_default: true,
		default_inverse: true,
		default_min_score_pct: 0,
		default_max_score_pct: 40
	};
	const penaltyShotType = {
		id: 'penalty_shot',
		category: 'punishment',
		coming_soon: false,
		enabled_by_default: false, // opt-in — needs cfg.types.penalty_shot.enabled=true
		default_inverse: true,
		default_min_score_pct: 0,
		default_max_score_pct: 40
	};
	const types = [lifelineType, penaltyShotType] as never[];

	const baseCtx: PlanContext = {
		submissionPct: 0,
		cumulativePct: 0,
		thresholdMode: 'per_challenge',
		bandMode: 'all_bands',
		lastThresholdCrossed: 0
	};

	// Low score (20% < the 40% bound), chance=1 for both (deterministic): both
	// fire, on the INVERSE channel, independent of any threshold band crossing
	// (thresholds_percent is irrelevant to this channel — powerups.ts:661-672).
	{
		const cfg = {
			version: 2 as const,
			threshold_mode: 'per_challenge' as const,
			band_mode: 'all_bands' as const,
			thresholds_percent: [], // deliberately empty: proves the inverse channel
			// does not depend on the ladder crossing anything.
			types: { penalty_shot: { enabled: true, chance: 1 }, lifeline: { chance: 1 } },
			categories: {}
		};
		const { awards, newHighwater } = planAwards(
			cfg,
			types,
			{ ...baseCtx, submissionPct: 20 },
			() => 0
		);
		assert(
			'low score (20% < 40% bound): both inverse types fire',
			awards.sort((a, b) => a.typeId.localeCompare(b.typeId)),
			[
				{ typeId: 'lifeline', channel: 'inverse' },
				{ typeId: 'penalty_shot', channel: 'inverse' }
			]
		);
		assert('the ladder never crossed anything (thresholds_percent is empty)', newHighwater, null);
	}

	// The upper edge of the range, and the ONE place laag 1 deliberately changed
	// behaviour.
	//
	// This channel used to compare with a strict `<` against a bound that the
	// ambiguous `threshold` key set, so exactly 40% did NOT fire. Laag 1 replaced
	// that with scoreInRange (src/lib/server/powerups.ts) — `min <= score% <= max`,
	// inclusive at both ends and identical for every type — so the bound itself is
	// now inside the range and 40% DOES fire.
	//
	// That is the only earn-outcome anywhere that moved; tests/bots/verify-
	// threshold-range.ts proves it exhaustively by diffing the old predicate
	// against the new one over the whole live catalog at every score.
	{
		const cfg = {
			version: 2 as const,
			threshold_mode: 'per_challenge' as const,
			band_mode: 'all_bands' as const,
			thresholds_percent: [],
			types: { penalty_shot: { enabled: true, chance: 1 }, lifeline: { chance: 1 } },
			categories: {}
		};
		const atBound = planAwards(cfg, types, { ...baseCtx, submissionPct: 40 }, () => 0);
		assert(
			'submissionPct exactly AT the upper bound (40%) NOW fires — inclusive range',
			atBound.awards.length,
			2
		);
		const justUnder = planAwards(cfg, types, { ...baseCtx, submissionPct: 39 }, () => 0);
		assert('one point under the bound (39%) fires both', justUnder.awards.length, 2);
		// The far side is untouched: one point ABOVE the bound is still out.
		const justOver = planAwards(cfg, types, { ...baseCtx, submissionPct: 41 }, () => 0);
		assert('one point over the bound (41%) still fires nothing', justOver.awards, []);
	}

	// penalty_shot's enabled_by_default=false means it needs the per-set
	// override; without it, only lifeline (enabled_by_default=true) fires.
	{
		const cfg = {
			version: 2 as const,
			threshold_mode: 'per_challenge' as const,
			band_mode: 'all_bands' as const,
			thresholds_percent: [],
			types: {}, // no overrides at all
			categories: {}
		};
		const { awards } = planAwards(cfg, types, { ...baseCtx, submissionPct: 10 }, () => 0);
		assert(
			'penalty_shot opt-in default: absent without an override',
			awards.find((a) => a.typeId === 'penalty_shot'),
			undefined
		);
		assert(
			'lifeline enabled_by_default=true: fires without an override',
			awards.find((a) => a.typeId === 'lifeline'),
			{ typeId: 'lifeline', channel: 'inverse' }
		);
	}

	// chance=0 is the deterministic non-firing edge (verify-earning.ts's own
	// convention for what's assertable on count, not sampled).
	{
		const cfg = {
			version: 2 as const,
			threshold_mode: 'per_challenge' as const,
			band_mode: 'all_bands' as const,
			thresholds_percent: [],
			types: { penalty_shot: { enabled: true, chance: 0 }, lifeline: { chance: 0 } },
			categories: {}
		};
		const { awards } = planAwards(cfg, types, { ...baseCtx, submissionPct: 5 }, () => 0.5);
		assert('chance=0: neither fires however low the score', awards, []);
	}
}

// ── the category switch, BOTH directions (R1 gap 4) ─────────────────────────
//
// verify-earning.ts's live scenario 5 asserts only the NEGATIVE half
// (categories.self=false → selfCount 0) — which also passes if the ladder never
// awards self types under ANY config. Which type drops per band is random live,
// so the positive control belongs here: pure planAwards, injected rand,
// single-type pools that force the pick. Expectations are design facts (the
// switch governs exactly its own category; absent means ON), hand-written — not
// read back from the planner.
async function verifyCategorySwitch() {
	console.log('\n── category switch: self types CAN drop; only the switch stops them ──');

	const selfType = {
		id: 'bonus_points',
		category: 'self',
		coming_soon: false,
		enabled_by_default: true,
		default_inverse: false,
		default_min_score_pct: 0,
		default_max_score_pct: 100
	};
	const defensiveType = {
		id: 'shield',
		category: 'defensive',
		coming_soon: false,
		enabled_by_default: true,
		default_inverse: false,
		default_min_score_pct: 0,
		default_max_score_pct: 100
	};

	const cfgWith = (categories: Record<string, boolean>) => ({
		version: 2 as const,
		threshold_mode: 'per_challenge' as const,
		band_mode: 'all_bands' as const,
		thresholds_percent: [25], // one band, crossed by the 100% below → exactly one pick
		types: {},
		categories
	});
	const ctx: PlanContext = {
		submissionPct: 100,
		cumulativePct: 0,
		thresholdMode: 'per_challenge',
		bandMode: 'all_bands',
		lastThresholdCrossed: 0
	};

	// THE POSITIVE CONTROL — the missing half. One band, a pool of exactly one
	// self type: the award MUST land on it. A planner that silently never deals
	// self types goes red here and nowhere else.
	{
		const { awards } = planAwards(cfgWith({}), [selfType] as never[], ctx, () => 0);
		assert('categories untouched: a self type DOES drop off the ladder', awards, [
			{ typeId: 'bonus_points', channel: 'ladder' }
		]);
	}
	// Boundary: explicitly true behaves like absent (the `?? true` default).
	{
		const { awards } = planAwards(cfgWith({ self: true }), [selfType] as never[], ctx, () => 0);
		assert('categories.self=true: still drops', awards, [
			{ typeId: 'bonus_points', channel: 'ladder' }
		]);
	}
	// The negative half, now deterministic instead of statistical.
	{
		const { awards } = planAwards(cfgWith({ self: false }), [selfType] as never[], ctx, () => 0);
		assert('categories.self=false: nothing drops', awards, []);
	}
	// Contrast: the switch removes ONLY its own category — a defensive type in
	// the same pool still fires. Guards against a switch that kills the pool.
	{
		const { awards } = planAwards(
			cfgWith({ self: false }),
			[selfType, defensiveType] as never[],
			ctx,
			() => 0
		);
		assert('self off: the defensive type in the same pool still drops', awards, [
			{ typeId: 'shield', channel: 'ladder' }
		]);
	}
}

/**
 * DE TWEE KANALEN TELLEN BIJ ELKAAR OP.
 *
 * Alles hierboven isoleert het inverse kanaal met een LEGE thresholds_percent,
 * juist om te bewijzen dat het niet van de ladder afhangt. Daardoor stond
 * nergens vastgelegd wat er gebeurt als ze allebei vuren op dezelfde inlevering
 * — en dat is precies de uitkomst die op een toestel voor verwarring zorgde:
 * 29% onder highest_band met drempels [20,75,100] levert TWEE powerups op, niet
 * één.
 *
 * Dat is bedoeld gedrag, en het bestaat uit twee onafhankelijke helften:
 *
 *   ladder    29% haalt band 20; highest_band collapst naar de hoogste gehaalde
 *             band, dus precies één trekking. Nooit meer, bij geen enkel
 *             percentage.
 *   invers    lifeline en penalty_shot staan allebei op 0-40 (migraties 0071 en
 *             0057) en lopen náást de ladder. Bij 29% zijn ze in bereik.
 *
 * Deze sectie pint die optelsom, plus de tegenproef: boven de 40% valt de
 * inverse helft weg en blijft er één over.
 */
async function verifyBeideKanalen() {
	console.log('\n── de twee kanalen op dezelfde inlevering ─────────────────────────');

	const types = [
		// Ladder: één type dat over het hele bereik meedoet, zodat de ladderhelft
		// altijd precies één trekking oplevert en de telling leesbaar blijft.
		{
			id: 'give_a_shot',
			category: 'social',
			coming_soon: false,
			enabled_by_default: true,
			default_inverse: false,
			default_min_score_pct: 0,
			default_max_score_pct: 100
		},
		{
			id: 'lifeline',
			category: 'defensive',
			coming_soon: false,
			enabled_by_default: true,
			default_inverse: true,
			default_min_score_pct: 0,
			default_max_score_pct: 40
		},
		{
			id: 'penalty_shot',
			category: 'punishment',
			coming_soon: false,
			enabled_by_default: true,
			default_inverse: true,
			default_min_score_pct: 0,
			default_max_score_pct: 40
		}
	] as never[];

	const cfg = {
		version: 2 as const,
		threshold_mode: 'per_challenge' as const,
		band_mode: 'highest_band' as const,
		thresholds_percent: [20, 75, 100],
		types: { lifeline: { chance: 1 }, penalty_shot: { chance: 1 } },
		categories: {}
	};
	const ctx = (pct: number): PlanContext => ({
		submissionPct: pct,
		cumulativePct: 0,
		thresholdMode: 'per_challenge',
		bandMode: 'highest_band',
		lastThresholdCrossed: 0
	});
	const tel = (pct: number) => {
		const { awards } = planAwards(cfg, types, ctx(pct), () => 0);
		return {
			ladder: awards.filter((a) => a.channel === 'ladder').length,
			invers: awards.filter((a) => a.channel === 'inverse').length
		};
	};

	// Het gemelde geval.
	assert('29%: één ladder + twee inverse = drie', tel(29), { ladder: 1, invers: 2 });

	// De ladderhelft alleen, over het hele bereik. highest_band collapst altijd
	// naar één — dit is de controle die "misschien collapst hij niet in dit pad"
	// beantwoordt.
	for (const pct of [20, 29, 50, 74, 75, 97, 100]) {
		assert(`highest_band: ${pct}% geeft precies één laddertrekking`, tel(pct).ladder, 1);
	}
	assert('19%: onder de laagste drempel vuurt de ladder niet', tel(19).ladder, 0);

	// De tegenproef: boven de 40% valt het inverse kanaal weg. Dat is waarom 97%
	// er één oplevert en 29% er drie — hetzelfde ladderaantal, ander bereik.
	assert('41%: inverse kanaal buiten bereik', tel(41), { ladder: 1, invers: 0 });
	assert('97%: alleen de ladder, dus één', tel(97), { ladder: 1, invers: 0 });

	// En de rand van het bereik, inclusief zoals scoreInRange belooft.
	assert('40%: nog net in bereik', tel(40).invers, 2);
}

async function main() {
	await verifyInverseEarning();
	await verifyCategorySwitch();
	await verifyBeideKanalen();

	const failed = checks.filter((c) => !c.pass);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	if (failed.length) {
		for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
		process.exit(1);
	}
}

void main();
