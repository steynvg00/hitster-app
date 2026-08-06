// Two-team OFFENSIVE harness — Time Drain (fase 2a).
//
//   npm run bots:verify-offensive-timedrain
//
// MUTATES THE REAL DATABASE, scoped to the Mechanics Test set — same class as
// verify-earning / verify-regression, and it reproduces their soft-reset rather
// than importing $lib (the bot harness deliberately avoids the alias resolver).
//
// The two-team fundament (soft-reset, derived deadline, grant/attempt helpers,
// the activity_log delta rule, the read-only precondition check) lives in
// ./offensive-harness.ts — extracted so fase 2b's freeze/tap_to_break/
// give_a_shot harness builds ON it rather than beside it. The reasoning for why
// this class of test cannot use the fake client is in that file's header.
//
// ── What the -15s actually IS (the thing worth stating plainly) ──────────────
//
// There is NO deadline column, and time_drain never touches the target's
// challenge_attempts row. powerups.ts:3050-3063 inserts ONE pre-consumed
// team_effects row carrying { added_seconds: -15, challenge_id }. The deadline
// the server enforces is DERIVED by summing added_seconds across
// time_boost/freeze/time_drain for that team+challenge:
//
//   src/routes/api/auto-submit/+server.ts:44-56   (the enforced deadline)
//   src/lib/server/powerups.ts:1560-1572          (lifeline's time gate, same sum)
//
// So this harness asserts the DERIVED deadline, which is strictly stronger than
// reading a column would have been: it is the number the backstop actually
// races.
//
// ── Oracle independence ─────────────────────────────────────────────────────
//
// DRAIN_SECONDS and the deadline formula are written out BY HAND from reading
// the branch, never imported from powerups.ts. If the harness imported the
// constant it was checking, a change from -15 to -5 would keep every check green
// while the game silently changed. timer_seconds IS read from the DB — that is
// an input fact about the challenge, not a claim by the code under test.
//
// ── Scope honesty ───────────────────────────────────────────────────────────
//
// This proves the SERVER-side effect: the right row on the right team, the
// derived deadline, the status transition, the refusals. It does NOT prove the
// target's phone visibly loses 15 seconds — the realtime handler in
// challenge/[id]/+page.svelte:808 is the browser layer, and a green run here
// says nothing about it.
//
// Requires: Mechanics Test set seeded (npm run seed:mechanics) and its
// game_sets.status = 'active' (activatePowerup gates on it at powerups.ts:1962).
// No app server and no browser needed — this drives activatePowerup() directly.

import { activatePowerup } from '../../src/lib/server/powerups';
import {
	CHALLENGE_ID,
	assert,
	bootstrap,
	effectiveDeadlineMs,
	effectsFor,
	freshWorld,
	grantHeld,
	logCount,
	newestLog,
	reportAndExit,
	softReset,
	statusOf,
	type Ctx
} from './offensive-harness';

// ── THE ORACLE, written by hand ───────────────────────────────────────────────
//
// powerups.ts:3049 reads `typeId === 'freeze' ? 30 : -15`. Transcribed, not
// imported, on purpose — see the header.
const DRAIN_SECONDS = -15;

// ── 1. The core: the drain lands on the TARGET ────────────────────────────────
async function verifyLandsOnTarget(ctx: Ctx) {
	console.log('\n── Time Drain: -15s lands on the TARGET, not the caster ──────────');
	const { db, attacker, target, timer } = ctx;
	const tpId = await freshWorld(ctx, 'time_drain');

	const targetBefore = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	const attackerBefore = await effectiveDeadlineMs(db, attacker, CHALLENGE_ID, timer);
	// Measured as a DELTA: softReset does not clear activity_log (see the
	// fundament's header) so an absolute count would creep upward every run.
	const logCountBefore = await logCount(db, 'time_drain');

	const res = await activatePowerup(db as never, tpId, { targetTeamId: target });
	assert('activation succeeds', res.success, true);
	assert('not reported as shield-blocked', res.blocked ?? false, false);

	const targetAfter = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	const attackerAfter = await effectiveDeadlineMs(db, attacker, CHALLENGE_ID, timer);

	// The oracle: exactly DRAIN_SECONDS off the target, nothing off the caster.
	assert('TARGET deadline moves by exactly -15s', (targetAfter! - targetBefore!) / 1000, DRAIN_SECONDS);
	assert('ATTACKER deadline unchanged', (attackerAfter! - attackerBefore!) / 1000, 0);

	// The cross-team claim, stated on the rows themselves rather than the maths.
	const onTarget = await effectsFor(db, target);
	const onAttacker = await effectsFor(db, attacker);
	assert('exactly one effect row on the target', onTarget.length, 1);
	assert('ZERO effect rows on the attacker', onAttacker.length, 0);

	const row = onTarget[0] as Record<string, unknown>;
	const payload = (row.payload ?? {}) as Record<string, unknown>;
	assert('row is a time_drain', row.effect_type, 'time_drain');
	assert('payload.added_seconds is -15', payload.added_seconds, DRAIN_SECONDS);
	assert('payload names the target challenge', payload.challenge_id, CHALLENGE_ID);
	assert('payload credits the caster', payload.source_team_id, attacker);
	assert('payload carries the caster name', payload.source_team_name, ctx.attackerName);
	assert('row is written pre-consumed', row.consumed_at !== null, true);
	assert('…against the target challenge', row.consumed_challenge_id, CHALLENGE_ID);
	assert('…and traceable to the powerup', row.source_team_powerup_id, tpId);

	assert('the caster spends the powerup', await statusOf(db, tpId), 'consumed');

	// The caster's attempt row itself must be untouched — the deadline moves via
	// the effect row, never by editing the target's (or the caster's) attempt.
	const { data: attackerAttempt } = await db
		.from('challenge_attempts')
		.select('ended_at, timer_override_seconds')
		.eq('challenge_id', CHALLENGE_ID)
		.eq('team_id', attacker)
		.maybeSingle();
	assert('attacker attempt still open', attackerAttempt?.ended_at ?? null, null);
	assert('attacker attempt has no timer override', attackerAttempt?.timer_override_seconds ?? null, null);

	assert(
		'exactly one new time_drain activity_log row',
		(await logCount(db, 'time_drain')) - logCountBefore,
		1
	);
	const log = await newestLog(db, 'time_drain');
	assert('…logged against the CASTER', log?.team_id, attacker);
	assert('…naming both sides', log?.payload, {
		source_team_id: attacker,
		target_team_id: target
	});
}

// ── 2. Stacking: drains are arithmetic, no guard ──────────────────────────────
async function verifyStacks(ctx: Ctx) {
	console.log('\n── Time Drain: stacks (arithmetic, unlike freeze) ────────────────');
	const { db, attacker, target, timer } = ctx;
	const tp1 = await freshWorld(ctx, 'time_drain');
	const tp2 = await grantHeld(db, attacker, 'time_drain');

	const before = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);

	const r1 = await activatePowerup(db as never, tp1, { targetTeamId: target });
	assert('first drain succeeds', r1.success, true);
	const afterOne = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	assert('after 1 drain: -15s', (afterOne! - before!) / 1000, DRAIN_SECONDS);

	const r2 = await activatePowerup(db as never, tp2, { targetTeamId: target });
	assert('second drain is NOT refused', r2.success, true);
	const afterTwo = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	assert('after 2 drains: -30s cumulative', (afterTwo! - before!) / 1000, DRAIN_SECONDS * 2);

	assert('two effect rows on the target', (await effectsFor(db, target)).length, 2);
	assert(
		'both powerups consumed',
		[await statusOf(db, tp1), await statusOf(db, tp2)],
		['consumed', 'consumed']
	);
}

// ── 3. The refusals ───────────────────────────────────────────────────────────
async function verifyRefusals(ctx: Ctx) {
	const { db, attacker, target, timer } = ctx;

	console.log('\n── Time Drain: refuses without a target ──────────────────────────');
	{
		const tpId = await freshWorld(ctx, 'time_drain');
		const before = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
		const res = await activatePowerup(db as never, tpId, {});
		assert('refused', res.success, false);
		assert('…with the target-required message', res.error, 'Time Drain requires a target team');
		assert('powerup stays held', await statusOf(db, tpId), 'held');
		assert('no effect row anywhere', (await effectsFor(db, target)).length, 0);
		assert(
			'target deadline untouched',
			(await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer))! - before!,
			0
		);
	}

	console.log('\n── Time Drain: refuses a self-target ─────────────────────────────');
	{
		const tpId = await freshWorld(ctx, 'time_drain');
		const before = await effectiveDeadlineMs(db, attacker, CHALLENGE_ID, timer);
		const res = await activatePowerup(db as never, tpId, { targetTeamId: attacker });
		assert('refused', res.success, false);
		assert('…with the self-target message', res.error, 'Cannot target your own team');
		assert('powerup stays held', await statusOf(db, tpId), 'held');
		assert('no effect row on the caster', (await effectsFor(db, attacker)).length, 0);
		assert(
			'caster deadline untouched',
			(await effectiveDeadlineMs(db, attacker, CHALLENGE_ID, timer))! - before!,
			0
		);
	}

	console.log('\n── Time Drain: refuses a target not in a timed challenge ─────────');
	{
		// Design B (powerups.ts:3010-3014): timer attacks need a LIVE timed attempt
		// on the target — there is no apply-on-next-challenge. Closing the target's
		// attempt is exactly that situation.
		const tpId = await freshWorld(ctx, 'time_drain');
		await db
			.from('challenge_attempts')
			.update({ ended_at: new Date().toISOString() })
			.eq('challenge_id', CHALLENGE_ID)
			.eq('team_id', target);

		const res = await activatePowerup(db as never, tpId, { targetTeamId: target });
		assert('refused', res.success, false);
		assert(
			'…with the not-in-a-timed-challenge message',
			res.error,
			"That team isn't in a timed challenge right now"
		);
		assert('powerup stays held (not burned on a miss)', await statusOf(db, tpId), 'held');
		assert('no effect row on the target', (await effectsFor(db, target)).length, 0);
	}
}

// ── 4. Shield still absorbs it (the fase-2b seam, asserted once here) ─────────
async function verifyShieldBlocks(ctx: Ctx) {
	console.log('\n── Time Drain vs Shield: absorbed, caster still pays ─────────────');
	const { db, target, timer } = ctx;
	const tpId = await freshWorld(ctx, 'time_drain');

	// A shield is an ACTIVE (non-consumed) team_effects row on the target —
	// the shape activatePowerup's shield branch writes (powerups.ts:2199-2230).
	const shieldTp = await grantHeld(db, target, 'shield');
	const shieldRes = await activatePowerup(db as never, shieldTp, {});
	assert('target raises a shield', shieldRes.success, true);

	const before = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	const res = await activatePowerup(db as never, tpId, { targetTeamId: target });

	assert('attack reports success', res.success, true);
	assert('…but flagged blocked', res.blocked, true);
	assert(
		'target deadline UNCHANGED (the point of a shield)',
		(await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer))! - before!,
		0
	);
	const rows = await effectsFor(db, target);
	assert('no time_drain row survives', rows.filter((r) => r.effect_type === 'time_drain').length, 0);
	assert(
		'a shield_block marker is written',
		rows.filter((r) => r.effect_type === 'shield_block').length,
		1
	);
	assert('attacker still spends the powerup', await statusOf(db, tpId), 'consumed');
	assert('shield is spent too', await statusOf(db, shieldTp), 'consumed');
}

async function main() {
	const ctx = await bootstrap();

	await verifyLandsOnTarget(ctx);
	await verifyStacks(ctx);
	await verifyRefusals(ctx);
	await verifyShieldBlocks(ctx);

	// Leave the set clean for the next harness.
	await softReset(ctx.db);

	reportAndExit();
}

void main();
