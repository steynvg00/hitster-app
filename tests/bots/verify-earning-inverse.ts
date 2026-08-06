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
		const { awards, newHighwater } = planAwards(cfg, types, { ...baseCtx, submissionPct: 20 }, () => 0);
		assert('low score (20% < 40% bound): both inverse types fire', awards.sort((a, b) => a.typeId.localeCompare(b.typeId)), [
			{ typeId: 'lifeline', channel: 'inverse' },
			{ typeId: 'penalty_shot', channel: 'inverse' }
		]);
		assert('the ladder never crossed anything (thresholds_percent is empty)', newHighwater, null);
	}

	// At/above the bound: submissionPct < bound is a strict inequality
	// (powerups.ts:669, `ctx.submissionPct < bound`) — exactly 40% must NOT fire.
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
		assert('submissionPct exactly AT the bound (40%) does not fire (strict <)', atBound.awards, []);
		const justUnder = planAwards(cfg, types, { ...baseCtx, submissionPct: 39 }, () => 0);
		assert('one point under the bound (39%) fires both', justUnder.awards.length, 2);
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
		assert('penalty_shot opt-in default: absent without an override', awards.find((a) => a.typeId === 'penalty_shot'), undefined);
		assert('lifeline enabled_by_default=true: fires without an override', awards.find((a) => a.typeId === 'lifeline'), { typeId: 'lifeline', channel: 'inverse' });
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

async function main() {
	await verifyInverseEarning();
	await verifyCategorySwitch();

	const failed = checks.filter((c) => !c.pass);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	if (failed.length) {
		for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
		process.exit(1);
	}
}

void main();
