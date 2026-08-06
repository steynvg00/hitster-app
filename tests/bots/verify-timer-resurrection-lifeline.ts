// Resurrection retry-clock + Lifeline time-gate verification (fase 3b).
//
//   npm run dev                      # needed for the /api/auto-submit half
//   npm run bots:verify-timer-resurrection-lifeline
//   FALSIFY=grace|override|lifeline|boost npm run …    # each must go RED
//
// Built on the fase-3a fundament (timer-harness.ts): nothing waits, every clock
// is written into the past. No new fundament here.
//
// ── The two remaining timer paths ────────────────────────────────────────────
//
// R. RESURRECTION opens a retry on a THIRD of the original clock, stored per
//    attempt in challenge_attempts.timer_override_seconds (powerups.ts:2814-2827,
//    migration 0074:75). /api/auto-submit lets that column win over the
//    challenge's own timer (+server.ts:71), so the retry must be closed on the
//    SHORT deadline. Proven two ways, as agreed:
//      * synthetically, with a matched control — two attempts with the SAME
//        started_at, one carrying the override and one not, in one fire;
//      * end to end, by driving the real activatePowerup() and letting the
//        backstop settle the retry it opened.
//
// L. LIFELINE is the one time-gated activation in the system: refused below half
//    the (boost-adjusted) clock (powerups.ts:2869). Driven through the real
//    activatePowerup() directly — powerups.ts imports no $env, so unlike
//    /api/auto-submit it needs no running server (precedent:
//    verify-offensive-timedrain.ts:50).
//
// ── The gap this pins down ───────────────────────────────────────────────────
//
// /api/auto-submit used to skip any attempt that already had a submission. A
// Resurrection retry re-opens its submission (is_final = false) and starts a
// fresh short clock, so an ABANDONED retry hit exactly that skip and was left
// unlocked forever — invisible to the recap, the podium, /play/thanks and the
// Eye, all of which filter on is_final. Today only a FINISHED submission is
// skipped (+server.ts:145); a non-final one falls through and settles.
//
// So the discriminating assertion for case R-D is NOT "the attempt closed" —
// the old buggy path closed it too. It is `submissions.is_final === true`: the
// retry settled and RE-LOCKED the challenge (submit.ts:337). Under the old
// behaviour that flag would still read false.
//
// ── The vacuum trap ──────────────────────────────────────────────────────────
//
// Fase 3a shipped a structural check that passed vacuously because its anchor
// resolved to an import. The lesson is generalised here: every expectation is a
// closure over a knob table, and vacuityGuard() re-evaluates it with the
// relevant knob perturbed and REQUIRES the verdict to flip. A case whose
// expectation survives its own constant being wrong cannot detect that constant
// being wrong, and is reported as vacuous. That guard runs on every invocation,
// alongside FALSIFY=<knob> which demonstrates real red end to end.
//
// ── Scope ────────────────────────────────────────────────────────────────────
//
// SERVER-side only, like 3a: the countdown a player sees, the client's own
// auto-submit and the realtime push are browser behaviour and are NOT covered.
// Writes stay inside the Mechanics set; the other active set is asserted
// unchanged in a finally-teardown so even a red run restores it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { assert, checks, grantHeld, reportAndExit, softReset, statusOf } from './offensive-harness';
import {
	FOREIGN_SET_ID,
	ORACLE_GRACE_MS,
	SET_ID,
	bootstrapTimer,
	fireAutoSubmit,
	globalOpenAttemptCount,
	grantTimerEffect,
	logCounts,
	logDelta,
	positionAttempt,
	positionSetClock,
	readAttempt,
	readSet,
	readSubmission,
	type TimerCtx
} from './timer-harness';
import { activatePowerup } from '../../src/lib/server/powerups';

const LOG_TYPES = ['resurrection_opened', 'resurrection_settled', 'crown_stolen', 'penalty_shot'];

// ── independent oracle knobs ─────────────────────────────────────────────────
//
// Hand-copied from the spec, never imported from the code under test.
// powerups-meta.ts:366 declares the retry fraction and :227 the Lifeline
// threshold; if either drifts from these literals the assertions go red, which
// is the whole point. `useOverride` is not a constant in the source at all — it
// is the BEHAVIOUR that +server.ts:71 prefers the attempt's own clock, expressed
// as a knob so a case can prove it depends on it.

export type Knobs = {
	graceMs: number;
	retryFraction: number;
	lifelineThreshold: number;
	useOverride: boolean;
	boostScale: number;
};

const TRUE_KNOBS: Knobs = {
	graceMs: ORACLE_GRACE_MS,
	retryFraction: 1 / 3,
	lifelineThreshold: 0.5,
	useOverride: true,
	boostScale: 1
};

/** FALSIFY=<knob> deliberately corrupts one knob; RED is then the correct result. */
function activeKnobs(): Knobs {
	switch (process.env.FALSIFY) {
		case 'grace':
			return { ...TRUE_KNOBS, graceMs: 0 };
		case 'override':
			return { ...TRUE_KNOBS, useOverride: false };
		case 'lifeline':
			return { ...TRUE_KNOBS, lifelineThreshold: 0.05 };
		case 'boost':
			return { ...TRUE_KNOBS, boostScale: 0 };
		default:
			return TRUE_KNOBS;
	}
}

const K = activeKnobs();

/** One third of the original clock, rounded, floored at 1s (powerups-meta.ts:384). */
function oracleRetrySeconds(timerSeconds: number, k: Knobs = K): number {
	return Math.max(1, Math.round(timerSeconds * k.retryFraction));
}

type ClaimInput = {
	startedAtMs: number;
	timerSeconds: number;
	overrideSeconds: number | null;
	addedSeconds: number;
	nowMs: number;
};

/**
 * SECTION-1 ORACLE, extended for the override. The attempt's own clock wins when
 * it has one; otherwise the challenge's. Grace is inside the threshold, as in 3a.
 */
function oracleExpectsClaim(i: ClaimInput, k: Knobs = K): boolean {
	const base = k.useOverride && i.overrideSeconds != null ? i.overrideSeconds : i.timerSeconds;
	const claimAt = i.startedAtMs + (base + i.addedSeconds * k.boostScale) * 1000 + k.graceMs;
	return claimAt < i.nowMs;
}

/** LIFELINE ORACLE: elapsed / (timer + Σ added_seconds) ≥ 0.5 (powerups.ts:1580). */
function oracleElapsedFraction(
	i: { startedAtMs: number; timerSeconds: number; addedSeconds: number; nowMs: number },
	k: Knobs = K
): number {
	const total = i.timerSeconds + i.addedSeconds * k.boostScale;
	return (i.nowMs - i.startedAtMs) / (total * 1000);
}

function oracleAllowsLifeline(
	i: Parameters<typeof oracleElapsedFraction>[0],
	k: Knobs = K
): boolean {
	return oracleElapsedFraction(i, k) >= k.lifelineThreshold;
}

// ── the vacuum guard ─────────────────────────────────────────────────────────

/**
 * Prove one expectation is not vacuous: re-evaluate it with the knob it claims
 * to depend on perturbed, and require the verdict to FLIP. A case that answers
 * the same either way cannot detect that knob being wrong, and its green is
 * meaningless — exactly the failure fase 3a shipped and caught late.
 */
function vacuityGuard(label: string, fn: (k: Knobs) => boolean, perturb: Partial<Knobs>) {
	const truth = fn(TRUE_KNOBS);
	const perturbed = fn({ ...TRUE_KNOBS, ...perturb });
	assert(
		`vacuity: ${label} flips when ${Object.keys(perturb).join('/')} is wrong`,
		truth !== perturbed,
		true
	);
}

// ── helpers local to this harness ────────────────────────────────────────────

async function readOverrideSeconds(
	db: SupabaseClient,
	teamId: string,
	challengeId: string
): Promise<number | null> {
	const { data } = await db
		.from('challenge_attempts')
		.select('timer_override_seconds')
		.eq('challenge_id', challengeId)
		.eq('team_id', teamId)
		.maybeSingle();
	return (data?.timer_override_seconds as number | null) ?? null;
}

/** The team's open (non-consumed) Resurrection ticket, if any. */
async function readTicket(db: SupabaseClient, teamId: string, challengeId: string) {
	const { data } = await db
		.from('team_effects')
		.select('id, payload, consumed_at')
		.eq('team_id', teamId)
		.eq('effect_type', 'resurrection')
		.is('consumed_at', null);
	return (data ?? []).find(
		(r) => (r.payload as { challenge_id?: string } | null)?.challenge_id === challengeId
	);
}

async function readLifelineEffect(db: SupabaseClient, teamId: string, challengeId: string) {
	const { data } = await db
		.from('team_effects')
		.select('id, payload, consumed_at, consumed_challenge_id')
		.eq('team_id', teamId)
		.eq('effect_type', 'lifeline')
		.eq('set_id', SET_ID);
	return (data ?? []).find((r) => r.consumed_challenge_id === challengeId);
}

/**
 * A finished submission to bring back. Minimal but honest: submissionFinalScore
 * (powerups.ts:338-347) reads answers[0].breakdown.final, so the ticket's
 * old_final comes from a real breakdown rather than from the bare score column.
 */
async function fabricateFinalSubmission(
	db: SupabaseClient,
	teamId: string,
	challengeId: string,
	finalScore: number
) {
	const { error } = await db.from('submissions').insert({
		challenge_id: challengeId,
		team_id: teamId,
		answers: [
			{
				track_id: null,
				field_values: {},
				scored: {},
				total: finalScore,
				breakdown: {
					base: finalScore,
					difficulty_multiplier: 1,
					round_multiplier: 1,
					comeback_multiplier: 1,
					streak_bonus: 0,
					speed_bonus: 0,
					final: finalScore
				}
			}
		],
		score: finalScore,
		is_final: true
	});
	if (error) throw new Error(`fabricateFinalSubmission failed: ${error.message}`);
}

// ── SECTION R — the retry clock ──────────────────────────────────────────────
//
// Run with the set's own clock cleared (started_at = null), the state the
// game-set flip cannot fire from (+server.ts:195) — so nothing observed here can
// be attributed to section 2. Same isolation trick as fase 3a.
async function sectionResurrection(ctx: TimerCtx) {
	const { db, teams, challengeIds, timerSeconds } = ctx;
	console.log('\n══ SECTION R — Resurrection retry runs on the SHORT clock ══');

	await softReset(db);
	await positionSetClock(db, { playState: 'playing', startedSecondsAgo: null });
	assert('R precondition: no open attempts anywhere', await globalOpenAttemptCount(db), 0);

	const challengeId = challengeIds[0];
	const retrySec = oracleRetrySeconds(timerSeconds, TRUE_KNOBS); // 90 → 30
	console.log(
		`  oracle: timer ${timerSeconds}s → retry ${retrySec}s (×1/3); ` +
			`retry claim point ${retrySec + ORACLE_GRACE_MS / 1000}s, full claim point ${timerSeconds + ORACLE_GRACE_MS / 1000}s`
	);
	assert('R oracle: retry clock is a third of the original', retrySec, 30);

	// Three attempts on ONE challenge. R2 and R3 share a started_at and differ
	// only in the override column — that pair is the whole claim.
	const cases = [
		{
			label: 'R1 override, just BEFORE short claim point',
			team: teams[0],
			ago: 38,
			override: retrySec
		},
		{
			label: 'R2 override, just AFTER short claim point',
			team: teams[1],
			ago: 65,
			override: retrySec
		},
		{ label: 'R3 NO override, same clock as R2 (control)', team: teams[2], ago: 65, override: null }
	];

	const positioned: { label: string; teamId: string; input: Omit<ClaimInput, 'nowMs'> }[] = [];
	for (const c of cases) {
		const { startedAtMs } = await positionAttempt(db, {
			teamId: c.team.id,
			challengeId,
			secondsAgo: c.ago,
			overrideSeconds: c.override
		});
		positioned.push({
			label: `${c.label} (${c.team.color})`,
			teamId: c.team.id,
			input: { startedAtMs, timerSeconds, overrideSeconds: c.override, addedSeconds: 0 }
		});
	}

	const before = await logCounts(db, LOG_TYPES);
	const fire = await fireAutoSubmit();
	assert('R fire: /api/auto-submit ok', fire.ok, true);

	for (const p of positioned) {
		const input = { ...p.input, nowMs: fire.nowMs };
		const expect = oracleExpectsClaim(input);
		const attempt = await readAttempt(db, p.teamId, challengeId);
		const claimAt =
			input.startedAtMs + ((input.overrideSeconds ?? input.timerSeconds) * 1000 + ORACLE_GRACE_MS);
		console.log(
			`  · ${p.label}: started ${Math.round((fire.nowMs - input.startedAtMs) / 1000)}s ago, ` +
				`override=${input.overrideSeconds ?? 'none'} → claim point ` +
				`${Math.round((claimAt - fire.nowMs) / 1000)}s ${claimAt > fire.nowMs ? 'away' : 'past'} ` +
				`→ oracle: ${expect ? 'CLAIM' : 'leave alone'}`
		);
		assert(`${p.label}: attempt ${expect ? 'closed' : 'still open'}`, attempt?.ended, expect);
	}

	// THE contrast: identical started_at, one override, one not — and only the
	// override one is claimed. This is what "the short clock governs" means.
	const r2 = await readAttempt(db, teams[1].id, challengeId);
	const r3 = await readAttempt(db, teams[2].id, challengeId);
	assert(
		'R2/R3 contrast: same clock, only the OVERRIDE attempt is closed',
		[r2?.ended, r3?.ended],
		[true, false]
	);

	console.log(
		`  activity_log DELTA: ${JSON.stringify(logDelta(before, await logCounts(db, LOG_TYPES)))}`
	);

	// ── vacuity: each verdict must depend on the knob it claims to test ───────
	const at = (ago: number, override: number | null) => ({
		startedAtMs: fire.nowMs - ago * 1000,
		timerSeconds,
		overrideSeconds: override,
		addedSeconds: 0,
		nowMs: fire.nowMs
	});
	vacuityGuard('R1 (38s, override)', (k) => oracleExpectsClaim(at(38, retrySec), k), {
		graceMs: 0
	});
	vacuityGuard('R2 (65s, override)', (k) => oracleExpectsClaim(at(65, retrySec), k), {
		useOverride: false
	});
	vacuityGuard(
		'R2/R3 contrast',
		(k) => oracleExpectsClaim(at(65, retrySec), k) && !oracleExpectsClaim(at(65, null), k),
		{ useOverride: false }
	);
}

// ── SECTION R-D — the closed gap, end to end ─────────────────────────────────
//
// Drives the REAL activatePowerup so the 1/3 and the override column come from
// production code, then abandons the retry and lets the backstop settle it.
async function sectionResurrectionEndToEnd(ctx: TimerCtx) {
	const { db, teams, challengeIds, timerSeconds } = ctx;
	console.log('\n══ SECTION R-D — abandoned retry settles (the closed gap) ══');

	// Fresh world: section R left two unclaimed attempts open, and R1 would drift
	// past its claim point while this section runs. Clearing them keeps the
	// resurrection_settled delta below attributable to this retry alone.
	await softReset(db);
	await positionSetClock(db, { playState: 'playing', startedSecondsAgo: null });

	const challengeId = challengeIds[1];
	const team = teams[3];
	const OLD_FINAL = 40;

	await fabricateFinalSubmission(db, team.id, challengeId, OLD_FINAL);
	const tpId = await grantHeld(db, team.id, 'resurrection');
	const res = await activatePowerup(db as never, tpId, { currentChallengeId: challengeId });
	assert('R-D: resurrection activates', res.success, true);

	// What the real activation left behind.
	const sub = await readSubmission(db, team.id, challengeId);
	const override = await readOverrideSeconds(db, team.id, challengeId);
	const ticket = await readTicket(db, team.id, challengeId);
	assert('R-D: submission re-opened (is_final false)', sub?.isFinal, false);
	assert(
		'R-D: attempt carries the 1/3 clock',
		override,
		oracleRetrySeconds(timerSeconds, TRUE_KNOBS)
	);
	assert('R-D: an open ticket exists', ticket != null, true);
	assert('R-D: powerup is active, not yet spent', await statusOf(db, tpId), 'active');

	// Abandon it: push the fresh attempt past the SHORT claim point (30+20 = 50s)
	// while staying well inside the original 110s one.
	const { startedAtMs } = await positionAttempt(db, {
		teamId: team.id,
		challengeId,
		secondsAgo: 65,
		overrideSeconds: override
	});

	const before = await logCounts(db, LOG_TYPES);
	const fire = await fireAutoSubmit();
	assert('R-D fire: /api/auto-submit ok', fire.ok, true);

	const input = {
		startedAtMs,
		timerSeconds,
		overrideSeconds: override,
		addedSeconds: 0,
		nowMs: fire.nowMs
	};
	const expect = oracleExpectsClaim(input);
	console.log(
		`  · abandoned retry (${team.color}) started 65s ago, override=${override}s → ` +
			`oracle: ${expect ? 'CLAIM' : 'leave alone'} ` +
			`(under the FULL ${timerSeconds}s clock it would be: ` +
			`${oracleExpectsClaim({ ...input, overrideSeconds: null }) ? 'CLAIM' : 'leave alone'})`
	);

	const attemptAfter = await readAttempt(db, team.id, challengeId);
	const subAfter = await readSubmission(db, team.id, challengeId);
	assert('R-D: attempt closed on the short clock', attemptAfter?.ended, expect);
	// THE gap assertion. The old buggy path also closed the attempt — what it did
	// NOT do was settle the submission, leaving is_final false forever.
	assert(
		'R-D: submission RE-LOCKED (is_final true) — not stranded unlocked',
		subAfter?.isFinal,
		true
	);
	assert('R-D: powerup spent by the settlement', await statusOf(db, tpId), 'consumed');

	const delta = logDelta(before, await logCounts(db, LOG_TYPES));
	console.log(`  activity_log DELTA across the settlement: ${JSON.stringify(delta)}`);
	assert('R-D: exactly one resurrection_settled (delta)', delta.resurrection_settled, 1);

	vacuityGuard(
		'R-D abandoned retry',
		(k) => oracleExpectsClaim({ ...input, nowMs: fire.nowMs }, k),
		{ useOverride: false }
	);
}

// ── SECTION L — the Lifeline half-way gate ───────────────────────────────────
//
// No HTTP at all: activatePowerup is driven directly. L2 and L3 share an elapsed
// time and differ only in a time_boost, which is the clean direction to show —
// the boost sits in the DENOMINATOR (powerups.ts:1577-1580), so it makes the
// same wall-clock moment a SMALLER fraction and pushes the gate LATER.
async function sectionLifeline(ctx: TimerCtx) {
	const { db, teams, challengeIds, timerSeconds } = ctx;
	console.log('\n══ SECTION L — Lifeline refused below half the (boosted) clock ══');

	await softReset(db);
	await positionSetClock(db, { playState: 'playing', startedSecondsAgo: null });

	const challengeId = challengeIds[0];
	const half = TRUE_KNOBS.lifelineThreshold;
	console.log(
		`  oracle: threshold ${half * 100}% → unlocks at ${timerSeconds * half}s unboosted, ` +
			`at ${(timerSeconds + 30) * half}s with a +30s boost`
	);

	const cases = [
		{ label: 'L1 just BELOW half', team: teams[0], ago: 38, boost: 0 },
		{ label: 'L2 just ABOVE half', team: teams[1], ago: 52, boost: 0 },
		{ label: 'L3 same clock as L2, +30s boost', team: teams[2], ago: 52, boost: 30 }
	];

	const before = await logCounts(db, LOG_TYPES);

	for (const c of cases) {
		const { startedAtMs } = await positionAttempt(db, {
			teamId: c.team.id,
			challengeId,
			secondsAgo: c.ago
		});
		if (c.boost) {
			await grantTimerEffect(db, {
				teamId: c.team.id,
				challengeId,
				effectType: 'time_boost',
				addedSeconds: c.boost
			});
		}

		const tpId = await grantHeld(db, c.team.id, 'lifeline');
		const nowMs = Date.now();
		const input = { startedAtMs, timerSeconds, addedSeconds: c.boost, nowMs };
		const expectAllow = oracleAllowsLifeline(input);
		const fraction = oracleElapsedFraction(input);

		const res = await activatePowerup(db as never, tpId, { currentChallengeId: challengeId });

		console.log(
			`  · ${c.label} (${c.team.color}): ${c.ago}s of ${timerSeconds + c.boost}s → ` +
				`fraction ${fraction.toFixed(3)} → oracle: ${expectAllow ? 'ALLOW' : 'REFUSE'}` +
				(res.success ? '' : `   [server: "${res.error}"]`)
		);

		assert(
			`${c.label}: activation ${expectAllow ? 'succeeds' : 'refused'}`,
			res.success,
			expectAllow
		);
		// A refusal must cost nothing — the same posture free_answer takes.
		assert(
			`${c.label}: powerup ${expectAllow ? 'consumed' : 'still held'}`,
			await statusOf(db, tpId),
			expectAllow ? 'consumed' : 'held'
		);
		const effect = await readLifelineEffect(db, c.team.id, challengeId);
		assert(
			`${c.label}: hint effect ${expectAllow ? 'written' : 'absent'}`,
			effect != null,
			expectAllow
		);
		if (expectAllow) {
			// Written already-consumed, exactly like free_answer's reveal row, so it
			// can never ride into scoring (powerups.ts:2894-2919).
			assert(`${c.label}: hint row is stored consumed`, effect?.consumed_at != null, true);
		} else {
			assert(`${c.label}: refusal says "too early"`, res.error?.startsWith('Too early'), true);
		}
	}

	console.log(
		`  activity_log DELTA: ${JSON.stringify(logDelta(before, await logCounts(db, LOG_TYPES)))}`
	);

	// ── vacuity ───────────────────────────────────────────────────────────────
	const nowRef = Date.now();
	const at = (ago: number, boost: number) => ({
		startedAtMs: nowRef - ago * 1000,
		timerSeconds,
		addedSeconds: boost,
		nowMs: nowRef
	});
	vacuityGuard('L1 (38s, no boost)', (k) => oracleAllowsLifeline(at(38, 0), k), {
		lifelineThreshold: 0.05
	});
	vacuityGuard('L2 (52s, no boost)', (k) => oracleAllowsLifeline(at(52, 0), k), {
		lifelineThreshold: 0.95
	});
	// L3 is the boost case: with the boost it is below half, without it above.
	vacuityGuard('L3 (52s, +30s boost)', (k) => oracleAllowsLifeline(at(52, 30), k), {
		boostScale: 0
	});
	vacuityGuard(
		'L2/L3 contrast (boost pushes the gate later)',
		(k) => oracleAllowsLifeline(at(52, 0), k) && !oracleAllowsLifeline(at(52, 30), k),
		{ boostScale: 0 }
	);
}

async function main() {
	console.log('▶ verify-timer-resurrection-lifeline — retry clock + Lifeline gate\n');
	const ctx = await bootstrapTimer();
	const foreignBefore = await readSet(ctx.db, FOREIGN_SET_ID);
	if (process.env.FALSIFY) {
		console.log(
			`  ⚠ FALSIFY=${process.env.FALSIFY} — one oracle knob is deliberately wrong; RED is correct\n`
		);
	}

	try {
		await sectionResurrection(ctx);
		await sectionResurrectionEndToEnd(ctx);
		await sectionLifeline(ctx);
	} finally {
		await softReset(ctx.db);
		const restored = await readSet(ctx.db, SET_ID);
		const foreignAfter = await readSet(ctx.db, FOREIGN_SET_ID);
		console.log(
			`\n  restored Mechanics set → play_state=${restored?.play_state} started_at=${restored?.started_at ?? 'null'}`
		);
		assert(
			'teardown: foreign set play_state unchanged',
			foreignAfter?.play_state,
			foreignBefore?.play_state
		);
		assert('teardown: Mechanics set back to joining', restored?.play_state, 'joining');
		assert('teardown: Mechanics set clock cleared', restored?.started_at, null);
	}

	if (process.env.FALSIFY) {
		const failed = checks.filter((c) => !c.pass).length;
		console.log(
			`\n  FALSIFY=${process.env.FALSIFY}: ${failed} check(s) red — ` +
				`${failed > 0 ? 'the oracle binds' : 'THE ORACLE IS NOT BINDING ANYTHING'}`
		);
	}
	reportAndExit();
}

main();
