// Auto-submit / timer backstop verification harness (fase 3a).
//
//   npm run dev                      # required — see "how it is called" below
//   npm run bots:verify-timer-autosubmit
//   FALSIFY=grace npm run bots:verify-timer-autosubmit   # must go RED
//
// ── What this proves, and what it does NOT ───────────────────────────────────
//
// PROVES (server side only): that /api/auto-submit's two independent sections
// react correctly to an ELAPSED clock —
//   * section 1 closes a per-team attempt past its deadline+grace, scores it
//     through the real pipeline on an empty draft, and leaves a not-yet-expired
//     attempt strictly alone;
//   * section 2 flips a game set whose total timer is up to play_state 'recap',
//     and does so even when section 1 had nothing whatsoever to do.
//
// DOES NOT PROVE: anything a browser does. The client-side countdown in the
// challenge page, its own `remaining <= 0` auto-submit, the realtime push that
// moves a phone to the recap screen, and the visible recap transition are all
// browser/realtime behaviour and are NOT covered here. A green run means the
// SERVER settles an expired clock correctly — nothing about what a player sees.
//
// Also NOT covered: the grace window as a real-time phenomenon. The boundary
// cases below straddle the claim point by backdating, which is the only way to
// test it deterministically; whether a throttled phone actually gets its 20 s
// reprieve remains a manual check (verify-regression.ts:31-33 says the same).
//
// ── The technique ────────────────────────────────────────────────────────────
//
// Nothing waits. `challenge_attempts.started_at` and `game_sets.started_at` are
// the only inputs to the two deadline computations, so the harness writes them
// into the past and the server sees an expired clock immediately. All of that
// lives in timer-harness.ts; this file is the scenarios and the oracle.
//
// ── Independence of the oracle ───────────────────────────────────────────────
//
// Every expectation comes from oracleExpectsClaim / oracleExpectsFlip in
// timer-harness.ts, which restate the deadline formulas from the spec with a
// LOCAL grace constant. Nothing is read back from the server's own numbers.
// `FALSIFY=grace` zeroes that constant and must turn case S1-B red — if it
// stays green the oracle is not binding anything.
//
// ── Scope of mutation ────────────────────────────────────────────────────────
//
// Writes are confined to the Mechanics set (attempts, submissions, effects, and
// that set's play_state/started_at). The other active set on this database is
// read and asserted UNCHANGED, never written. The run ends with a soft reset
// that puts play_state back to 'joining' and clears started_at — including on
// failure, so a red run cannot leave the set parked in 'recap'.

import type { SupabaseClient } from '@supabase/supabase-js';
import { assert, checks, reportAndExit, softReset } from './offensive-harness';
import {
	FOREIGN_SET_ID,
	SET_ID,
	bootstrapTimer,
	falsifyMode,
	fireAutoSubmit,
	globalOpenAttemptCount,
	grantTimerEffect,
	logCounts,
	logDelta,
	oracleClaimAtMs,
	oracleExpectsClaim,
	oracleExpectsFlip,
	oracleSetFlipDueMs,
	positionAttempt,
	positionSetClock,
	readAttempt,
	readSet,
	readSubmission,
	type FireResult,
	type TimerCtx
} from './timer-harness';

/** activity_log types the backstop's scoring pipeline can reach. Differenced. */
const LOG_TYPES = ['crown_stolen', 'penalty_shot', 'resurrection_settled', 'battle_award'];

type Case = {
	label: string;
	teamId: string;
	teamName: string;
	challengeId: string;
	timerSeconds: number;
	/** How far in the past the attempt's clock is placed before a fire. */
	secondsAgo: number;
	/** Σ added_seconds the oracle should account for (timer effects on this pair). */
	addedSeconds: number;
	startedAtMs: number;
};

/**
 * Re-place every case's clock immediately before firing. Positions are re-applied
 * per fire on purpose: the boundary cases sit ~12-15 s from the claim point, and
 * the wall-clock cost of an HTTP round trip between two fires would otherwise
 * drift a "just before" case across the boundary and flake the run.
 */
async function positionAll(db: SupabaseClient, cases: Case[]) {
	for (const c of cases) {
		const { startedAtMs } = await positionAttempt(db, {
			teamId: c.teamId,
			challengeId: c.challengeId,
			secondsAgo: c.secondsAgo
		});
		c.startedAtMs = startedAtMs;
	}
}

/** Assert one case against the independent oracle. */
async function assertCase(db: SupabaseClient, c: Case, fire: FireResult) {
	const oracleArgs = {
		startedAtMs: c.startedAtMs,
		timerSeconds: c.timerSeconds,
		addedSeconds: c.addedSeconds
	};
	const expectClaimed = oracleExpectsClaim({ ...oracleArgs, nowMs: fire.nowMs });
	const marginSec = Math.round((oracleClaimAtMs(oracleArgs) - fire.nowMs) / 1000);

	const attempt = await readAttempt(db, c.teamId, c.challengeId);
	const sub = await readSubmission(db, c.teamId, c.challengeId);

	console.log(
		`  · ${c.label} (${c.teamName}) started ${c.secondsAgo}s ago, ` +
			`+${c.addedSeconds}s effects → claim point ${marginSec > 0 ? `${marginSec}s away` : `${-marginSec}s past`}` +
			` → oracle: ${expectClaimed ? 'CLAIM' : 'leave alone'}`
	);

	assert(
		`S1 ${c.label}: attempt ${expectClaimed ? 'closed' : 'still open'}`,
		attempt?.ended,
		expectClaimed
	);
	assert(
		`S1 ${c.label}: submission ${expectClaimed ? 'created + is_final' : 'absent'}`,
		sub === null ? null : sub.isFinal,
		expectClaimed ? true : null
	);
	if (expectClaimed) {
		assert(`S1 ${c.label}: empty draft scores 0`, sub?.score, 0);
	}
}

// ── SECTION 1 — per-team challenge auto-close ────────────────────────────────
//
// Deliberately run with the set's OWN clock cleared (started_at = null), which
// is the state section 2 cannot fire from (+server.ts:195 requires a non-null
// started_at). Section 1 is therefore observed in isolation: anything that moves
// here was moved by the per-team path and nothing else.
async function sectionOne(ctx: TimerCtx) {
	const { db, teams, challengeIds, timerSeconds } = ctx;
	console.log('\n══ SECTION 1 — per-team challenge auto-close (set clock cleared) ══');

	await softReset(db);
	// play_state 'playing' so the backstop can resolve the challenge's active set
	// (+server.ts:111-125) and run the real earning/crown path; started_at null so
	// section 2 stays dormant throughout.
	await positionSetClock(db, { playState: 'playing', startedSecondsAgo: null });

	const strayOpen = await globalOpenAttemptCount(db);
	assert('S1 precondition: no foreign open attempts anywhere', strayOpen, 0);

	const challengeId = challengeIds[0];
	// Claim point = timer + 20 s grace = 110 s with the seeded 90 s timer.
	// B sits PAST the raw deadline but BEFORE the claim point — that is the case
	// that can only pass if the grace window is really honoured.
	const cases: Case[] = [
		{ label: 'A well past deadline', secondsAgo: 200, addedSeconds: 0 },
		{ label: 'B just BEFORE claim point', secondsAgo: 98, addedSeconds: 0 },
		{ label: 'C just AFTER claim point', secondsAgo: 125, addedSeconds: 0 },
		{ label: 'D boosted, before extended deadline', secondsAgo: 125, addedSeconds: 30 }
	].map((c, i) => ({
		...c,
		teamId: teams[i].id,
		teamName: teams[i].color,
		challengeId,
		timerSeconds,
		startedAtMs: 0
	}));

	// D's time_boost: a payload-driven marker row keyed to this team + challenge,
	// exactly the shape the backstop sums at +server.ts:42-55.
	const boostCase = cases[3];
	await grantTimerEffect(db, {
		teamId: boostCase.teamId,
		challengeId,
		effectType: 'time_boost',
		addedSeconds: 30
	});

	// ── fire 1 ────────────────────────────────────────────────────────────────
	await positionAll(db, cases);
	const before = await logCounts(db, LOG_TYPES);
	const fire1 = await fireAutoSubmit();
	assert('S1 fire 1: /api/auto-submit ok', fire1.ok, true);
	for (const c of cases) await assertCase(db, c, fire1);
	// A and C expired, B and D did not.
	assert('S1 fire 1: created exactly the 2 expired attempts', fire1.created, 2);

	const after = await logCounts(db, LOG_TYPES);
	const delta = logDelta(before, after);
	console.log(`  activity_log DELTA across fire 1: ${JSON.stringify(delta)}`);
	// A score of 0 can never overtake the leader, so no crown can change hands.
	// Measured as a delta — an absolute count would pass on a virgin database and
	// creep on every later run (offensive-harness.ts:23-30).
	assert('S1 fire 1: no crown_stolen (delta)', delta.crown_stolen, 0);

	// ── fire 2: the boost's extended deadline finally passes ──────────────────
	// D moves past timer+boost+grace (90+30+20 = 140 s); B is re-placed at the
	// same offset so it stays a live "not yet" control across a second fire.
	console.log('\n  — fire 2: push the boosted attempt past its EXTENDED deadline —');
	boostCase.secondsAgo = 160;
	await positionAll(
		db,
		cases.filter((c) => c === boostCase || c === cases[1])
	);
	const fire2 = await fireAutoSubmit();
	assert('S1 fire 2: /api/auto-submit ok', fire2.ok, true);
	await assertCase(db, boostCase, fire2);
	await assertCase(db, cases[1], fire2);
	assert('S1 fire 2: created exactly the boosted attempt', fire2.created, 1);

	// The other real set on this database was never a target and must be inert.
	const foreign = await readSet(db, FOREIGN_SET_ID);
	assert('S1: foreign set untouched (still recap)', foreign?.play_state, 'recap');
}

// ── SECTION 2 — game-set total-timer flip ────────────────────────────────────
//
// This is the historical bug's territory. The old code opened with
// `if (!challenges?.length) return`, which meant a set whose per-challenge
// timers had nothing to contribute never reached the game-set check at all and
// sat in 'playing' forever. Today the challenge block is a GUARD that closes
// before this section (+server.ts:185) and the handler's only return is at :218,
// after both.
//
// SCOPE LIMIT, stated plainly: the bug's literal precondition was an EMPTY
// challenges query, and that query is database-wide (17 rows carry
// timer_seconds > 0 here). Emptying it would mean deleting production challenge
// rows, so this harness reproduces the semantically equivalent state instead —
// section 1 with nothing whatsoever to do — and asserts the flip happens anyway.
// The `created: 0` assertion below is what carries that claim: the flip cannot
// be a side effect of the challenge path if the challenge path settled nothing.
// The remaining gap (a re-introduced early return) is closed structurally by
// assertGuardPosition() rather than behaviourally.
async function sectionTwo(ctx: TimerCtx) {
	const { db, setTotalTimerSeconds: total } = ctx;
	console.log('\n══ SECTION 2 — game-set total-timer flip (no attempts in play) ══');

	await softReset(db);

	// The precondition that gives this section its meaning: not one open attempt
	// exists anywhere, so section 1 has literally nothing to settle.
	const openBefore = await globalOpenAttemptCount(db);
	assert('S2 precondition: zero open attempts anywhere (section 1 is idle)', openBefore, 0);

	// ── S2-A: timer NOT yet up — must stay in 'playing' ───────────────────────
	const notYetAgo = total - 120;
	const startedA = await positionSetClock(db, {
		playState: 'playing',
		startedSecondsAgo: notYetAgo
	});
	const beforeA = await logCounts(db, LOG_TYPES);
	const fireA = await fireAutoSubmit();
	assert('S2-A fire: /api/auto-submit ok', fireA.ok, true);

	const expectFlipA = oracleExpectsFlip(startedA ?? 0, total, fireA.nowMs);
	console.log(
		`  · set started ${notYetAgo}s ago, total timer ${total}s → ` +
			`${Math.round((oracleSetFlipDueMs(startedA ?? 0, total) - fireA.nowMs) / 1000)}s remaining ` +
			`→ oracle: ${expectFlipA ? 'FLIP' : 'stay playing'}`
	);
	const setA = await readSet(db, SET_ID);
	assert('S2-A: set still playing', setA?.play_state, expectFlipA ? 'recap' : 'playing');
	assert('S2-A: ended_at still clear', setA?.ended_at, null);
	assert('S2-A: section 1 settled nothing', fireA.created, 0);
	console.log(
		`  activity_log DELTA across fire A: ${JSON.stringify(logDelta(beforeA, await logCounts(db, LOG_TYPES)))}`
	);

	// ── S2-B: timer up — must flip even though section 1 is idle ──────────────
	const expiredAgo = total + 60;
	const startedB = await positionSetClock(db, {
		playState: 'playing',
		startedSecondsAgo: expiredAgo
	});
	const openAtFire = await globalOpenAttemptCount(db);
	assert('S2-B precondition: still zero open attempts', openAtFire, 0);

	const beforeB = await logCounts(db, LOG_TYPES);
	const fireB = await fireAutoSubmit();
	assert('S2-B fire: /api/auto-submit ok', fireB.ok, true);

	const expectFlipB = oracleExpectsFlip(startedB ?? 0, total, fireB.nowMs);
	console.log(
		`  · set started ${expiredAgo}s ago, total timer ${total}s → ` +
			`${Math.round((fireB.nowMs - oracleSetFlipDueMs(startedB ?? 0, total)) / 1000)}s past due ` +
			`→ oracle: ${expectFlipB ? 'FLIP' : 'stay playing'}`
	);
	const setB = await readSet(db, SET_ID);
	assert('S2-B: set flipped to recap', setB?.play_state, expectFlipB ? 'recap' : 'playing');
	assert('S2-B: ended_at stamped', setB?.ended_at != null, expectFlipB);
	// The independence claim, in one number: nothing was settled by section 1,
	// and the flip happened regardless.
	assert('S2-B: flip happened with section 1 idle (created 0)', fireB.created, 0);
	console.log(
		`  activity_log DELTA across fire B: ${JSON.stringify(logDelta(beforeB, await logCounts(db, LOG_TYPES)))}`
	);

	const foreign = await readSet(db, FOREIGN_SET_ID);
	assert('S2: foreign set untouched (still recap)', foreign?.play_state, 'recap');
}

async function main() {
	console.log('▶ verify-timer-autosubmit — server-side timer/backstop verification\n');
	const ctx = await bootstrapTimer();
	const foreignBefore = await readSet(ctx.db, FOREIGN_SET_ID);

	try {
		await sectionOne(ctx);
		await sectionTwo(ctx);
	} finally {
		// Always restore: a red run must not leave the Mechanics set mid-flight.
		await softReset(ctx.db);
		const restored = await readSet(ctx.db, SET_ID);
		console.log(
			`\n  restored Mechanics set → play_state=${restored?.play_state} started_at=${restored?.started_at ?? 'null'}`
		);
		const foreignAfter = await readSet(ctx.db, FOREIGN_SET_ID);
		assert(
			'teardown: foreign set play_state unchanged',
			foreignAfter?.play_state,
			foreignBefore?.play_state
		);
		assert('teardown: Mechanics set back to joining', restored?.play_state, 'joining');
		assert('teardown: Mechanics set clock cleared', restored?.started_at, null);
	}

	if (falsifyMode()) {
		const failed = checks.filter((c) => !c.pass).length;
		console.log(
			`\n  FALSIFY=${falsifyMode()}: ${failed} check(s) red — ` +
				`${failed > 0 ? 'the oracle binds' : 'THE ORACLE IS NOT BINDING ANYTHING'}`
		);
	}
	reportAndExit();
}

main();
