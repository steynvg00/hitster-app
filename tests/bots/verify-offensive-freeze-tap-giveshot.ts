// Two-team OFFENSIVE harness — Freeze, Tap to Break, Give a Shot (fase 2b).
//
//   npm run bots:verify-offensive-freeze-tap-giveshot
//
// Completes the offensive coverage started by verify-offensive-timedrain.ts
// (fase 2a). It builds on the SAME fundament — ./offensive-harness.ts — rather
// than a second one: same set-scoped soft-reset, same derived deadline, same
// grant/attempt helpers, same read-only precondition check, same activity_log
// delta rule. Only the oracles are new.
//
// MUTATES THE REAL DATABASE, scoped to the Mechanics Test set. Why a real DB and
// not the hardened fake client: an offensive powerup's claim is SEMANTIC ("the
// effect landed on the OTHER team"), and a recording fake can only echo back the
// team id it was handed. See offensive-harness.ts's header.
//
// ── The three shapes, and how they differ ───────────────────────────────────
//
// FREEZE (powerups.ts:2995-3074, shares the branch with time_drain)
//   One PRE-CONSUMED marker row on the target carrying added_seconds: +30. There
//   is no separate "frost marker" row — that single row is both halves of the
//   mechanic: the deadline sum reads payload.added_seconds (auto-submit/+server
//   .ts:44-56) while the client keys the frost overlay off effect_type ===
//   'freeze' (challenge/[id]/+page.svelte:797-807). The +30 is COMPENSATION for
//   the 30 seconds the target spends frozen, not a gift.
//   Does NOT stack: hasActiveFreeze (powerups.ts:1295-1310) rejects a second
//   freeze while one is inside its 30s window on the same challenge.
//
// TAP TO BREAK (powerups.ts:3076-3143)
//   The one attack whose row is NOT pre-consumed: no consumed_at, no
//   source_team_powerup_id. It stays live until the target taps it out through
//   /api/effects/consume, which is why a page reload re-surfaces it for free.
//   It does not move the clock at all. Does NOT stack: hasActiveTapLock
//   (powerups.ts:1320-1332) rejects a second lock while one is unbroken.
//
// GIVE A SHOT (powerups.ts:2944-2992) — the odd one out, in four ways:
//   1. No timer gate. It never calls resolveTargetTimedAttempt, so it lands on a
//      team that is in no challenge at all — the other two refuse that.
//   2. Not pre-consumed (like tap_to_break); the target acknowledges "Drunk!".
//   3. No stacking guard of any kind → two shots make two rows.
//   4. category = 'social' (migration 0058:33), and it is purely a real-world
//      forfeit: no score impact, no clock impact.
//
// ── Oracle independence ─────────────────────────────────────────────────────
//
// FREEZE_SECONDS (+30), FREEZE_WINDOW_MS (30s) and TAPS_REQUIRED (20), plus
// every expected error string, are transcribed BY HAND from reading the
// branches — never imported from powerups.ts. A harness that imported the
// constant it checks would stay green while the game silently changed. Only
// timer_seconds is read from the DB, and that is an input fact about the
// challenge rather than a claim by the code under test.
//
// Falsifiability was demonstrated, not assumed: flipping FREEZE_SECONDS 30 → 25
// and TAPS_REQUIRED 20 → 10 turned the corresponding checks red, and reverting
// turned them green again.
//
// ── Scope honesty ───────────────────────────────────────────────────────────
//
// This proves the SERVER effect only: the right row, with the right payload, on
// the right team, plus the status transitions, the stacking guards and the
// refusals. It proves NOTHING about the visible/interactive half — the frost
// overlay, the actual 20 taps and the realtime delivery all live in
// challenge/[id]/+page.svelte and belong to a browser/Cowork test. A green run
// here does not mean a target's phone ever showed anything.
//
// Requires: Mechanics Test set seeded (npm run seed:mechanics) and its
// game_sets.status = 'active' (activatePowerup gates on it at powerups.ts:1962).

import { activatePowerup } from '../../src/lib/server/powerups';
import {
	CHALLENGE_ID,
	SET_ID,
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

// ── THE ORACLES, written by hand ──────────────────────────────────────────────
// powerups.ts:3049  `typeId === 'freeze' ? 30 : -15`
const FREEZE_SECONDS = 30;
// powerups.ts:1300  `new Date(Date.now() - 30_000)` — the stacking window
const FREEZE_WINDOW_MS = 30_000;
// powerups.ts:3128  `taps_required: 20`
const TAPS_REQUIRED = 20;

const keysOf = (o: unknown) => Object.keys((o ?? {}) as Record<string, unknown>).sort();

/** The target breaks the lock — exactly what /api/effects/consume does. */
async function breakLock(ctx: Ctx, effectId: string) {
	await ctx.db
		.from('team_effects')
		.update({ consumed_at: new Date().toISOString() })
		.eq('id', effectId)
		.is('consumed_at', null);
}

// ══════════════════════════════════════════════════════════════════════════════
// FREEZE
// ══════════════════════════════════════════════════════════════════════════════

async function freezeLandsOnTarget(ctx: Ctx) {
	console.log('\n── Freeze: +30s compensation lands on the TARGET ─────────────────');
	const { db, attacker, target, timer } = ctx;
	const tpId = await freshWorld(ctx, 'freeze');

	const targetBefore = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	const attackerBefore = await effectiveDeadlineMs(db, attacker, CHALLENGE_ID, timer);
	const logBefore = await logCount(db, 'freeze');

	const res = await activatePowerup(db as never, tpId, { targetTeamId: target });
	assert('activation succeeds', res.success, true);
	assert('not reported as shield-blocked', res.blocked ?? false, false);

	const targetAfter = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	const attackerAfter = await effectiveDeadlineMs(db, attacker, CHALLENGE_ID, timer);
	assert('TARGET deadline moves by exactly +30s', (targetAfter! - targetBefore!) / 1000, FREEZE_SECONDS);
	assert('ATTACKER deadline unchanged', (attackerAfter! - attackerBefore!) / 1000, 0);

	const onTarget = await effectsFor(db, target);
	const onAttacker = await effectsFor(db, attacker);
	// ONE row, not two: the compensation and the frost marker are the same row.
	assert('exactly one effect row on the target', onTarget.length, 1);
	assert('ZERO effect rows on the attacker', onAttacker.length, 0);

	const row = onTarget[0] as Record<string, unknown>;
	const payload = (row.payload ?? {}) as Record<string, unknown>;
	assert('row is a freeze', row.effect_type, 'freeze');
	assert('payload.added_seconds is +30', payload.added_seconds, FREEZE_SECONDS);
	assert('payload names the target challenge', payload.challenge_id, CHALLENGE_ID);
	assert('payload credits the caster', payload.source_team_id, attacker);
	assert('payload carries the caster name', payload.source_team_name, ctx.attackerName);
	assert('payload carries nothing else', keysOf(payload), [
		'added_seconds',
		'challenge_id',
		'source_team_id',
		'source_team_name'
	]);
	assert('row is written pre-consumed', row.consumed_at !== null, true);
	assert('…against the target challenge', row.consumed_challenge_id, CHALLENGE_ID);
	assert('…and traceable to the powerup', row.source_team_powerup_id, tpId);
	// activated_at is the substrate the no-stacking guard reads (the row is
	// already consumed, so consumed_at cannot carry that meaning).
	assert('row carries an activated_at (the stack guard reads it)', row.activated_at !== null, true);

	assert('the caster spends the powerup', await statusOf(db, tpId), 'consumed');

	// The clock moves through the effect row only — never by editing an attempt.
	const { data: targetAttempt } = await db
		.from('challenge_attempts')
		.select('ended_at, timer_override_seconds')
		.eq('challenge_id', CHALLENGE_ID)
		.eq('team_id', target)
		.maybeSingle();
	assert('target attempt still open', targetAttempt?.ended_at ?? null, null);
	assert('target attempt has no timer override', targetAttempt?.timer_override_seconds ?? null, null);

	assert('exactly one new freeze activity_log row', (await logCount(db, 'freeze')) - logBefore, 1);
	const log = await newestLog(db, 'freeze');
	assert('…logged against the CASTER', log?.team_id, attacker);
	assert('…naming both sides', log?.payload, { source_team_id: attacker, target_team_id: target });
}

async function freezeDoesNotStack(ctx: Ctx) {
	console.log('\n── Freeze: does NOT stack while the 30s window is open ───────────');
	const { db, attacker, target, timer } = ctx;
	const tp1 = await freshWorld(ctx, 'freeze');
	const tp2 = await grantHeld(db, attacker, 'freeze');

	const before = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	const r1 = await activatePowerup(db as never, tp1, { targetTeamId: target });
	assert('first freeze succeeds', r1.success, true);
	const afterOne = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	assert('after 1 freeze: +30s', (afterOne! - before!) / 1000, FREEZE_SECONDS);

	// The refusal — and the reason it matters: a second freeze would otherwise
	// buy the target +60s of deadline for 30s of being frozen.
	const r2 = await activatePowerup(db as never, tp2, { targetTeamId: target });
	assert('second freeze IS refused', r2.success, false);
	assert('…with the already-frozen message', r2.error, 'Target is already frozen');
	assert('the refused powerup stays held', await statusOf(db, tp2), 'held');
	assert('still exactly one freeze row', (await effectsFor(db, target)).length, 1);
	assert(
		'deadline still +30s, NOT +60s',
		(await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer))! - before!,
		FREEZE_SECONDS * 1000
	);
}

async function freezeGuardIsWindowed(ctx: Ctx) {
	console.log('\n── Freeze: the guard is a 30s WINDOW, not a permanent block ──────');
	const { db, target, timer } = ctx;
	const tpId = await freshWorld(ctx, 'freeze');

	// A freeze whose window has already elapsed: activated_at just past the 30s
	// cutoff. Written by hand rather than by waiting 31 real seconds.
	await db.from('team_effects').insert({
		team_id: target,
		set_id: SET_ID,
		effect_type: 'freeze',
		payload: { added_seconds: FREEZE_SECONDS, challenge_id: CHALLENGE_ID },
		activated_at: new Date(Date.now() - (FREEZE_WINDOW_MS + 1_000)).toISOString(),
		consumed_at: new Date(Date.now() - (FREEZE_WINDOW_MS + 1_000)).toISOString(),
		consumed_challenge_id: CHALLENGE_ID
	});

	const before = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	const res = await activatePowerup(db as never, tpId, { targetTeamId: target });
	assert('a freeze whose window expired does not block a new one', res.success, true);
	assert('the new freeze adds its own +30s', (await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer))! - before!, FREEZE_SECONDS * 1000);
	assert('two freeze rows now exist (old + new)', (await effectsFor(db, target)).length, 2);
	assert('the caster spends the powerup', await statusOf(db, tpId), 'consumed');
}

async function freezeRefusals(ctx: Ctx) {
	const { db, attacker, target, timer } = ctx;

	console.log('\n── Freeze: refuses without a target ──────────────────────────────');
	{
		const tpId = await freshWorld(ctx, 'freeze');
		const before = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
		const res = await activatePowerup(db as never, tpId, {});
		assert('refused', res.success, false);
		assert('…with the target-required message', res.error, 'Freeze requires a target team');
		assert('powerup stays held', await statusOf(db, tpId), 'held');
		assert('no effect row anywhere', (await effectsFor(db, target)).length, 0);
		assert(
			'target deadline untouched',
			(await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer))! - before!,
			0
		);
	}

	console.log('\n── Freeze: refuses a self-target ─────────────────────────────────');
	{
		const tpId = await freshWorld(ctx, 'freeze');
		const before = await effectiveDeadlineMs(db, attacker, CHALLENGE_ID, timer);
		const res = await activatePowerup(db as never, tpId, { targetTeamId: attacker });
		assert('refused', res.success, false);
		assert('…with the self-target message', res.error, 'Cannot target your own team');
		assert('powerup stays held', await statusOf(db, tpId), 'held');
		assert('no effect row on the caster', (await effectsFor(db, attacker)).length, 0);
		assert(
			'caster deadline untouched (no self-freeze loophole)',
			(await effectiveDeadlineMs(db, attacker, CHALLENGE_ID, timer))! - before!,
			0
		);
	}

	console.log('\n── Freeze: refuses a target not in a timed challenge ─────────────');
	{
		// Design B (powerups.ts:3010-3014): no apply-on-next-challenge.
		const tpId = await freshWorld(ctx, 'freeze');
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
		assert('powerup stays held (a miss does not burn it)', await statusOf(db, tpId), 'held');
		assert('no effect row on the target', (await effectsFor(db, target)).length, 0);
	}
}

async function freezeShieldBlocks(ctx: Ctx) {
	console.log('\n── Freeze vs Shield: absorbed, caster still pays ─────────────────');
	const { db, target, timer } = ctx;
	const tpId = await freshWorld(ctx, 'freeze');

	const shieldTp = await grantHeld(db, target, 'shield');
	assert('target raises a shield', (await activatePowerup(db as never, shieldTp, {})).success, true);

	const before = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	const res = await activatePowerup(db as never, tpId, { targetTeamId: target });
	assert('attack reports success', res.success, true);
	assert('…but flagged blocked', res.blocked, true);
	assert(
		'target deadline UNCHANGED — no freeze, so no +30s either',
		(await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer))! - before!,
		0
	);
	const rows = await effectsFor(db, target);
	assert('no freeze row survives', rows.filter((r) => r.effect_type === 'freeze').length, 0);
	const blocks = rows.filter((r) => r.effect_type === 'shield_block');
	assert('a shield_block marker is written', blocks.length, 1);
	assert(
		'…naming freeze as what it blocked',
		(blocks[0].payload as Record<string, unknown>).blocked_type,
		'freeze'
	);
	assert('attacker still spends the powerup', await statusOf(db, tpId), 'consumed');
	assert('shield is spent too', await statusOf(db, shieldTp), 'consumed');
}

// ══════════════════════════════════════════════════════════════════════════════
// TAP TO BREAK
// ══════════════════════════════════════════════════════════════════════════════

async function tapLandsOnTarget(ctx: Ctx) {
	console.log('\n── Tap to Break: a LIVE lock lands on the TARGET ─────────────────');
	const { db, attacker, target, timer } = ctx;
	const tpId = await freshWorld(ctx, 'tap_to_break');

	const targetBefore = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	const attackerBefore = await effectiveDeadlineMs(db, attacker, CHALLENGE_ID, timer);
	const logBefore = await logCount(db, 'tap_to_break');

	const res = await activatePowerup(db as never, tpId, { targetTeamId: target });
	assert('activation succeeds', res.success, true);
	assert('not reported as shield-blocked', res.blocked ?? false, false);

	// A lock is not a clock effect: neither side's deadline may move.
	assert(
		'TARGET deadline unchanged (it locks, it does not drain)',
		(await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer))! - targetBefore!,
		0
	);
	assert(
		'ATTACKER deadline unchanged',
		(await effectiveDeadlineMs(db, attacker, CHALLENGE_ID, timer))! - attackerBefore!,
		0
	);

	const onTarget = await effectsFor(db, target);
	assert('exactly one effect row on the target', onTarget.length, 1);
	assert('ZERO effect rows on the attacker', (await effectsFor(db, attacker)).length, 0);

	const row = onTarget[0] as Record<string, unknown>;
	const payload = (row.payload ?? {}) as Record<string, unknown>;
	assert('row is a tap_to_break', row.effect_type, 'tap_to_break');
	assert('payload.taps_required is 20', payload.taps_required, TAPS_REQUIRED);
	assert('payload names the target challenge', payload.challenge_id, CHALLENGE_ID);
	assert('payload credits the caster', payload.source_team_id, attacker);
	assert('payload carries the caster name', payload.source_team_name, ctx.attackerName);
	assert('payload carries nothing else', keysOf(payload), [
		'challenge_id',
		'source_team_id',
		'source_team_name',
		'taps_required'
	]);
	// THE distinguishing property: unlike freeze/time_drain this row is left
	// ALIVE, which is what makes it survive a reload and what the tap-out clears.
	assert('row is NOT pre-consumed — the lock is live', row.consumed_at, null);
	assert('…and carries no source_team_powerup_id', row.source_team_powerup_id, null);
	assert('…and no consumed_challenge_id', row.consumed_challenge_id, null);

	assert('the caster spends the powerup anyway', await statusOf(db, tpId), 'consumed');

	assert(
		'exactly one new tap_to_break activity_log row',
		(await logCount(db, 'tap_to_break')) - logBefore,
		1
	);
	const log = await newestLog(db, 'tap_to_break');
	assert('…logged against the CASTER', log?.team_id, attacker);
	assert('…naming both sides', log?.payload, { source_team_id: attacker, target_team_id: target });
}

async function tapDoesNotStack(ctx: Ctx) {
	console.log('\n── Tap to Break: does NOT stack while a lock is unbroken ─────────');
	const { db, attacker, target } = ctx;
	const tp1 = await freshWorld(ctx, 'tap_to_break');
	const tp2 = await grantHeld(db, attacker, 'tap_to_break');

	assert('first lock succeeds', (await activatePowerup(db as never, tp1, { targetTeamId: target })).success, true);

	const r2 = await activatePowerup(db as never, tp2, { targetTeamId: target });
	assert('second lock IS refused', r2.success, false);
	assert('…with the already-locked message', r2.error, 'Target is already locked');
	assert('the refused powerup stays held', await statusOf(db, tp2), 'held');
	assert(
		'still exactly one lock row',
		(await effectsFor(db, target)).filter((r) => r.effect_type === 'tap_to_break').length,
		1
	);

	// The guard is "while unbroken", not "once ever": after the target taps out
	// (the /api/effects/consume write), a fresh lock is allowed again.
	const live = (await effectsFor(db, target)).find((r) => r.effect_type === 'tap_to_break')!;
	await breakLock(ctx, live.id as string);
	const r3 = await activatePowerup(db as never, tp2, { targetTeamId: target });
	assert('after the target breaks free, a NEW lock is allowed', r3.success, true);
	assert('the second powerup is spent now', await statusOf(db, tp2), 'consumed');
	const rows = (await effectsFor(db, target)).filter((r) => r.effect_type === 'tap_to_break');
	assert('two lock rows exist (one broken, one live)', rows.length, 2);
	assert('exactly one of them is still live', rows.filter((r) => r.consumed_at === null).length, 1);
}

async function tapRefusals(ctx: Ctx) {
	const { db, attacker, target } = ctx;

	console.log('\n── Tap to Break: refuses without a target ────────────────────────');
	{
		const tpId = await freshWorld(ctx, 'tap_to_break');
		const res = await activatePowerup(db as never, tpId, {});
		assert('refused', res.success, false);
		assert('…with the target-required message', res.error, 'Tap to Break requires a target team');
		assert('powerup stays held', await statusOf(db, tpId), 'held');
		assert('no effect row anywhere', (await effectsFor(db, target)).length, 0);
	}

	console.log('\n── Tap to Break: refuses a self-target ───────────────────────────');
	{
		const tpId = await freshWorld(ctx, 'tap_to_break');
		const res = await activatePowerup(db as never, tpId, { targetTeamId: attacker });
		assert('refused', res.success, false);
		assert('…with the self-target message', res.error, 'Cannot target your own team');
		assert('powerup stays held', await statusOf(db, tpId), 'held');
		assert('no effect row on the caster', (await effectsFor(db, attacker)).length, 0);
	}

	console.log('\n── Tap to Break: refuses a target not in a timed challenge ───────');
	{
		const tpId = await freshWorld(ctx, 'tap_to_break');
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
		assert('powerup stays held (a miss does not burn it)', await statusOf(db, tpId), 'held');
		assert('no effect row on the target', (await effectsFor(db, target)).length, 0);
	}
}

async function tapShieldBlocks(ctx: Ctx) {
	console.log('\n── Tap to Break vs Shield: absorbed, caster still pays ───────────');
	const { db, target } = ctx;
	const tpId = await freshWorld(ctx, 'tap_to_break');

	const shieldTp = await grantHeld(db, target, 'shield');
	assert('target raises a shield', (await activatePowerup(db as never, shieldTp, {})).success, true);

	const res = await activatePowerup(db as never, tpId, { targetTeamId: target });
	assert('attack reports success', res.success, true);
	assert('…but flagged blocked', res.blocked, true);
	const rows = await effectsFor(db, target);
	assert('NO lock row survives', rows.filter((r) => r.effect_type === 'tap_to_break').length, 0);
	const blocks = rows.filter((r) => r.effect_type === 'shield_block');
	assert('a shield_block marker is written', blocks.length, 1);
	assert(
		'…naming tap_to_break as what it blocked',
		(blocks[0].payload as Record<string, unknown>).blocked_type,
		'tap_to_break'
	);
	assert('attacker still spends the powerup', await statusOf(db, tpId), 'consumed');
	assert('shield is spent too', await statusOf(db, shieldTp), 'consumed');
}

// ══════════════════════════════════════════════════════════════════════════════
// GIVE A SHOT
// ══════════════════════════════════════════════════════════════════════════════

async function shotLandsOnTarget(ctx: Ctx) {
	console.log('\n── Give a Shot: a live forfeit lands on the TARGET ───────────────');
	const { db, attacker, target, timer } = ctx;
	const tpId = await freshWorld(ctx, 'give_a_shot');

	const targetBefore = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	const { data: teamsBefore } = await db.from('teams').select('id, score').in('id', [attacker, target]);
	const logBefore = await logCount(db, 'give_a_shot');

	const res = await activatePowerup(db as never, tpId, { targetTeamId: target });
	assert('activation succeeds', res.success, true);
	assert('not reported as shield-blocked', res.blocked ?? false, false);

	// Purely social: no clock, no score, on either side.
	assert(
		'TARGET deadline unchanged',
		(await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer))! - targetBefore!,
		0
	);
	const { data: teamsAfter } = await db.from('teams').select('id, score').in('id', [attacker, target]);
	const scoreOf = (rows: typeof teamsAfter, id: string) => rows?.find((t) => t.id === id)?.score ?? null;
	assert('TARGET score unchanged', scoreOf(teamsAfter, target), scoreOf(teamsBefore, target));
	assert('ATTACKER score unchanged', scoreOf(teamsAfter, attacker), scoreOf(teamsBefore, attacker));

	const onTarget = await effectsFor(db, target);
	assert('exactly one effect row on the target', onTarget.length, 1);
	assert('ZERO effect rows on the attacker', (await effectsFor(db, attacker)).length, 0);

	const row = onTarget[0] as Record<string, unknown>;
	const payload = (row.payload ?? {}) as Record<string, unknown>;
	assert('row is a give_a_shot', row.effect_type, 'give_a_shot');
	assert('payload credits the caster', payload.source_team_id, attacker);
	assert('payload carries the caster name', payload.source_team_name, ctx.attackerName);
	// No challenge_id and no added_seconds — this attack is not bound to a
	// challenge and does not participate in the deadline sum.
	assert('payload carries ONLY the source pair', keysOf(payload), [
		'source_team_id',
		'source_team_name'
	]);
	assert('row is NOT pre-consumed — the target must acknowledge', row.consumed_at, null);
	assert('…and carries no source_team_powerup_id', row.source_team_powerup_id, null);
	assert('…and no consumed_challenge_id', row.consumed_challenge_id, null);

	assert('the caster spends the powerup', await statusOf(db, tpId), 'consumed');

	assert(
		'exactly one new give_a_shot activity_log row',
		(await logCount(db, 'give_a_shot')) - logBefore,
		1
	);
	const log = await newestLog(db, 'give_a_shot');
	assert('…logged against the CASTER', log?.team_id, attacker);
	assert('…naming both sides', log?.payload, { source_team_id: attacker, target_team_id: target });
}

async function shotNeedsNoChallenge(ctx: Ctx) {
	console.log('\n── Give a Shot: lands on a team in NO challenge at all ───────────');
	const { db, target } = ctx;
	// The exact state freeze/tap_to_break refuse — no attempt on the target.
	const tpId = await freshWorld(ctx, 'give_a_shot', { targetAttempt: false });

	const { data: attempts } = await db
		.from('challenge_attempts')
		.select('id')
		.eq('team_id', target)
		.is('ended_at', null);
	assert('precondition: target has no open attempt', attempts?.length ?? 0, 0);

	const res = await activatePowerup(db as never, tpId, { targetTeamId: target });
	assert('activation still succeeds (no timer gate)', res.success, true);
	assert('the row lands anyway', (await effectsFor(db, target)).length, 1);
	assert('the caster spends the powerup', await statusOf(db, tpId), 'consumed');

	// Contrast, proving the gate is real for the others and genuinely absent here.
	const freezeTp = await grantHeld(db, ctx.attacker, 'freeze');
	const freezeRes = await activatePowerup(db as never, freezeTp, { targetTeamId: target });
	assert('…while a Freeze at the SAME target is refused', freezeRes.success, false);
	assert(
		'…for exactly the reason give_a_shot ignores',
		freezeRes.error,
		"That team isn't in a timed challenge right now"
	);
	assert('and that Freeze stays held', await statusOf(db, freezeTp), 'held');
}

async function shotStacks(ctx: Ctx) {
	console.log('\n── Give a Shot: STACKS (no guard — two shots, two rows) ──────────');
	const { db, attacker, target } = ctx;
	const tp1 = await freshWorld(ctx, 'give_a_shot');
	const tp2 = await grantHeld(db, attacker, 'give_a_shot');

	assert('first shot succeeds', (await activatePowerup(db as never, tp1, { targetTeamId: target })).success, true);
	const r2 = await activatePowerup(db as never, tp2, { targetTeamId: target });
	assert('second shot is NOT refused', r2.success, true);

	const rows = (await effectsFor(db, target)).filter((r) => r.effect_type === 'give_a_shot');
	assert('two independent shot rows on the target', rows.length, 2);
	assert('both still awaiting acknowledgement', rows.filter((r) => r.consumed_at === null).length, 2);
	assert(
		'both powerups consumed',
		[await statusOf(db, tp1), await statusOf(db, tp2)],
		['consumed', 'consumed']
	);
}

async function shotRefusals(ctx: Ctx) {
	const { db, attacker, target } = ctx;

	console.log('\n── Give a Shot: refuses without a target ─────────────────────────');
	{
		const tpId = await freshWorld(ctx, 'give_a_shot');
		const res = await activatePowerup(db as never, tpId, {});
		assert('refused', res.success, false);
		assert('…with the target-required message', res.error, 'Give a Shot requires a target team');
		assert('powerup stays held', await statusOf(db, tpId), 'held');
		assert('no effect row anywhere', (await effectsFor(db, target)).length, 0);
	}

	console.log('\n── Give a Shot: refuses a self-target ────────────────────────────');
	{
		const tpId = await freshWorld(ctx, 'give_a_shot');
		const res = await activatePowerup(db as never, tpId, { targetTeamId: attacker });
		assert('refused', res.success, false);
		assert('…with the self-target message', res.error, 'Cannot target your own team');
		assert('powerup stays held', await statusOf(db, tpId), 'held');
		assert('no effect row on the caster', (await effectsFor(db, attacker)).length, 0);
	}
}

async function shotShieldBlocks(ctx: Ctx) {
	console.log('\n── Give a Shot vs Shield: absorbed, caster still pays ────────────');
	const { db, target } = ctx;
	const tpId = await freshWorld(ctx, 'give_a_shot');

	const shieldTp = await grantHeld(db, target, 'shield');
	assert('target raises a shield', (await activatePowerup(db as never, shieldTp, {})).success, true);

	const res = await activatePowerup(db as never, tpId, { targetTeamId: target });
	assert('attack reports success', res.success, true);
	assert('…but flagged blocked', res.blocked, true);
	const rows = await effectsFor(db, target);
	assert('NO give_a_shot row survives', rows.filter((r) => r.effect_type === 'give_a_shot').length, 0);
	const blocks = rows.filter((r) => r.effect_type === 'shield_block');
	assert('a shield_block marker is written', blocks.length, 1);
	assert(
		'…naming give_a_shot as what it blocked',
		(blocks[0].payload as Record<string, unknown>).blocked_type,
		'give_a_shot'
	);
	assert('attacker still spends the powerup', await statusOf(db, tpId), 'consumed');
	assert('shield is spent too', await statusOf(db, shieldTp), 'consumed');
}

// ══════════════════════════════════════════════════════════════════════════════

async function main() {
	const ctx = await bootstrap();

	console.log('\n════ FREEZE ═════════════════════════════════════════════════════');
	await freezeLandsOnTarget(ctx);
	await freezeDoesNotStack(ctx);
	await freezeGuardIsWindowed(ctx);
	await freezeRefusals(ctx);
	await freezeShieldBlocks(ctx);

	console.log('\n════ TAP TO BREAK ═══════════════════════════════════════════════');
	await tapLandsOnTarget(ctx);
	await tapDoesNotStack(ctx);
	await tapRefusals(ctx);
	await tapShieldBlocks(ctx);

	console.log('\n════ GIVE A SHOT ════════════════════════════════════════════════');
	await shotLandsOnTarget(ctx);
	await shotNeedsNoChallenge(ctx);
	await shotStacks(ctx);
	await shotRefusals(ctx);
	await shotShieldBlocks(ctx);

	// Leave the set clean for the next harness.
	await softReset(ctx.db);

	reportAndExit();
}

void main();
