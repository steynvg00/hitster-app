// Two-team OFFENSIVE harness — Time Drain (fase 2a).
//
//   npm run bots:verify-offensive-timedrain
//
// MUTATES THE REAL DATABASE, scoped to the Mechanics Test set — same class as
// verify-earning / verify-regression, and it reproduces their soft-reset rather
// than importing $lib (the bot harness deliberately avoids the alias resolver).
//
// ── Why this one cannot be a fake ────────────────────────────────────────────
//
// The hardened fake client (tests/bots/fake-supabase.ts) validates SCHEMA: does
// this column exist, is this row shaped right. Every self/defensive powerup is
// coverable that way because the only team involved is the caster's own.
//
// An offensive powerup asks a different question, and it is a SEMANTIC one:
//
//   * does the effect land on the TARGET, and not on the caster?
//   * does the caster's own clock stay untouched?
//   * is the caster's powerup really spent?
//
// A recording fake answers "you wrote a row with team_id = <the string you
// passed>". That is not evidence — it is the same string, echoed. Only a real
// database with two real teams, two real attempts and a real deadline
// computation can tell those apart. Hence: real DB.
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
// DRAIN_SECONDS and the deadline formula below are written out BY HAND from
// reading the branch, never imported from powerups.ts. If the harness imported
// the constant it was checking, a change from -15 to -5 would keep every check
// green while the game silently changed. timer_seconds IS read from the DB —
// that is an input fact about the challenge, not a claim by the code under test.
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
// game_sets.status = 'active' (activatePowerup gates on it at powerups.ts:1953).
// No app server and no browser needed — this drives activatePowerup() directly.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { activatePowerup } from '../../src/lib/server/powerups';

// ── .env loader (only sets keys not already in the environment) ───────────────
function loadEnv() {
	try {
		const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
		for (const line of raw.split('\n')) {
			const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
			if (!m) continue;
			let val = m[2].trim();
			if (
				(val.startsWith('"') && val.endsWith('"')) ||
				(val.startsWith("'") && val.endsWith("'"))
			) {
				val = val.slice(1, -1);
			}
			if (!(m[1] in process.env)) process.env[m[1]] = val;
		}
	} catch {
		/* no .env — rely on the real environment */
	}
}

const SET_ID = 'e5100000-0000-4000-8000-000000000001';
// A timed challenge from the Mechanics set (timer_seconds = 90, status active).
// Its timer is read from the DB below rather than assumed.
const CHALLENGE_ID = 'e5100000-0000-4000-8000-000000000020';

// ── THE ORACLE, written by hand ───────────────────────────────────────────────
//
// powerups.ts:3049 reads `typeId === 'freeze' ? 30 : -15`. Transcribed, not
// imported, on purpose — see the header.
const DRAIN_SECONDS = -15;

// ── tiny assert harness (same shape as the other bots:verify-* scripts) ───────
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass ? JSON.stringify(got) : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
	});
	console.log(`  ${pass ? '✓' : '✗'} ${name}  ${checks[checks.length - 1].detail}`);
}

/** Soft-reset scoped to the Mechanics set — mirrors reset.ts's operations. */
async function softReset(db: SupabaseClient) {
	const { data: scRows } = await db
		.from('set_challenges')
		.select('challenge_id')
		.eq('set_id', SET_ID);
	const challengeIds = [...new Set((scRows ?? []).map((s) => s.challenge_id as string))];

	await db.from('team_powerups').delete().eq('set_id', SET_ID);
	await db.from('team_effects').delete().eq('set_id', SET_ID);
	if (challengeIds.length) {
		await db.from('submissions').delete().in('challenge_id', challengeIds);
		await db.from('challenge_attempts').delete().in('challenge_id', challengeIds);
		await db.from('challenge_hints_used').delete().in('challenge_id', challengeIds);
	}
	await db.from('challenge_unlocks').delete().eq('set_id', SET_ID);
	await db
		.from('teams')
		.update({ score: 0, current_streak: 0, held_powerups: [], last_threshold_crossed: 0 })
		.not('id', 'is', null); // all teams (Supabase requires a filter on update)
	await db.from('players').update({ set_id: null, team_id: null }).eq('set_id', SET_ID);
	await db
		.from('game_sets')
		.update({
			play_state: 'joining',
			started_at: null,
			ended_at: null,
			crown_holder_team_id: null,
			crown_payout_applied: false
		})
		.eq('id', SET_ID);
}

/**
 * The deadline a team is really racing on this challenge, computed the way the
 * SERVER computes it (auto-submit/+server.ts:44-56) but written out here
 * independently:
 *
 *   started_at + ((timer_override_seconds ?? challenge.timer_seconds) + Σ added_seconds) * 1000
 *
 * Σ runs over the team's time_boost / freeze / time_drain effect rows whose
 * payload.challenge_id matches. Returns null when the team has no open attempt.
 */
async function effectiveDeadlineMs(
	db: SupabaseClient,
	teamId: string,
	challengeId: string,
	baseTimerSeconds: number
): Promise<number | null> {
	const { data: attempt } = await db
		.from('challenge_attempts')
		.select('started_at, timer_override_seconds')
		.eq('challenge_id', challengeId)
		.eq('team_id', teamId)
		.is('ended_at', null)
		.maybeSingle();
	if (!attempt?.started_at) return null;

	const { data: rows } = await db
		.from('team_effects')
		.select('payload')
		.eq('team_id', teamId)
		.in('effect_type', ['time_boost', 'freeze', 'time_drain']);

	let added = 0;
	for (const r of rows ?? []) {
		const p = (r.payload ?? {}) as { added_seconds?: number; challenge_id?: string };
		if (p.challenge_id !== challengeId) continue;
		if (typeof p.added_seconds === 'number' && Number.isFinite(p.added_seconds)) added += p.added_seconds;
	}

	const seconds = (attempt.timer_override_seconds as number | null) ?? baseTimerSeconds;
	return new Date(attempt.started_at as string).getTime() + (seconds + added) * 1000;
}

/** Give a team a held powerup of `typeId`. Returns the team_powerups row id. */
async function grantHeld(db: SupabaseClient, teamId: string, typeId: string): Promise<string> {
	const { data, error } = await db
		.from('team_powerups')
		.insert({ team_id: teamId, set_id: SET_ID, powerup_type_id: typeId, status: 'held' })
		.select('id')
		.single();
	if (error || !data) throw new Error(`grantHeld(${typeId}) failed: ${error?.message}`);
	return data.id as string;
}

/** Open an attempt for `teamId` on `challengeId`, started `startedAgoMs` ago. */
async function openAttempt(
	db: SupabaseClient,
	teamId: string,
	challengeId: string,
	startedAgoMs = 0
): Promise<string> {
	const startedAt = new Date(Date.now() - startedAgoMs).toISOString();
	const { data, error } = await db
		.from('challenge_attempts')
		.insert({ challenge_id: challengeId, team_id: teamId, started_at: startedAt })
		.select('id')
		.single();
	if (error || !data) throw new Error(`openAttempt failed: ${error?.message}`);
	return data.id as string;
}

type Ctx = {
	db: SupabaseClient;
	attacker: string;
	target: string;
	attackerName: string;
	targetName: string;
	timer: number;
};

/**
 * Fresh two-team world: reset, both teams open an attempt on the same timed
 * challenge (allowed — challenge_attempts is unique on the PAIR
 * (challenge_id, team_id), migration 0014:16), attacker holds a Time Drain.
 */
async function freshWorld(ctx: Ctx, opts: { attackerAttempt?: boolean } = {}) {
	const { db, attacker, target } = ctx;
	await softReset(db);
	await openAttempt(db, target, CHALLENGE_ID);
	if (opts.attackerAttempt !== false) await openAttempt(db, attacker, CHALLENGE_ID);
	return grantHeld(db, attacker, 'time_drain');
}

const effectsFor = async (db: SupabaseClient, teamId: string) =>
	(
		await db
			.from('team_effects')
			.select('effect_type, payload, consumed_at, consumed_challenge_id, source_team_powerup_id')
			.eq('team_id', teamId)
			.eq('set_id', SET_ID)
	).data ?? [];

/** How many time_drain rows the activity log holds right now (see the delta note). */
const timeDrainLogCount = async (db: SupabaseClient) =>
	(await db.from('activity_log').select('id').eq('event_type', 'time_drain')).data?.length ?? 0;

const statusOf = async (db: SupabaseClient, tpId: string) =>
	(await db.from('team_powerups').select('status').eq('id', tpId).maybeSingle()).data?.status ??
	null;

// ── 1. The core: the drain lands on the TARGET ────────────────────────────────
async function verifyLandsOnTarget(ctx: Ctx) {
	console.log('\n── Time Drain: -15s lands on the TARGET, not the caster ──────────');
	const { db, attacker, target, timer } = ctx;
	const tpId = await freshWorld(ctx);

	const targetBefore = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	const attackerBefore = await effectiveDeadlineMs(db, attacker, CHALLENGE_ID, timer);
	// activity_log is the one table the soft-reset does NOT clear (CLAUDE.md's reset
	// SQL deletes it; verify-regression/verify-earning's softReset deliberately does
	// not, and this harness copies theirs). So the log is measured as a DELTA across
	// the activation rather than as an absolute count — an absolute count would pass
	// on a virgin database and creep upward on every later run.
	const logCountBefore = await timeDrainLogCount(db);

	const res = await activatePowerup(db as never, tpId, { targetTeamId: target });
	assert('activation succeeds', res.success, true);
	assert('not reported as shield-blocked', res.blocked ?? false, false);

	const targetAfter = await effectiveDeadlineMs(db, target, CHALLENGE_ID, timer);
	const attackerAfter = await effectiveDeadlineMs(db, attacker, CHALLENGE_ID, timer);

	// The oracle: exactly DRAIN_SECONDS off the target, nothing off the caster.
	assert(
		'TARGET deadline moves by exactly -15s',
		(targetAfter! - targetBefore!) / 1000,
		DRAIN_SECONDS
	);
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

	assert('exactly one new time_drain activity_log row', (await timeDrainLogCount(db)) - logCountBefore, 1);
	const { data: log } = await db
		.from('activity_log')
		.select('event_type, team_id, payload')
		.eq('event_type', 'time_drain')
		.order('created_at', { ascending: false })
		.limit(1);
	assert('…logged against the CASTER', log?.[0]?.team_id, attacker);
	assert('…naming both sides', log?.[0]?.payload, {
		source_team_id: attacker,
		target_team_id: target
	});
}

// ── 2. Stacking: drains are arithmetic, no guard ──────────────────────────────
async function verifyStacks(ctx: Ctx) {
	console.log('\n── Time Drain: stacks (arithmetic, unlike freeze) ────────────────');
	const { db, attacker, target, timer } = ctx;
	const tp1 = await freshWorld(ctx);
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
	assert('both powerups consumed', [await statusOf(db, tp1), await statusOf(db, tp2)], [
		'consumed',
		'consumed'
	]);
}

// ── 3. The refusals ───────────────────────────────────────────────────────────
async function verifyRefusals(ctx: Ctx) {
	const { db, attacker, target, timer } = ctx;

	console.log('\n── Time Drain: refuses without a target ──────────────────────────');
	{
		const tpId = await freshWorld(ctx);
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
		const tpId = await freshWorld(ctx);
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
		const tpId = await freshWorld(ctx);
		await db
			.from('challenge_attempts')
			.update({ ended_at: new Date().toISOString() })
			.eq('challenge_id', CHALLENGE_ID)
			.eq('team_id', target);

		const res = await activatePowerup(db as never, tpId, { targetTeamId: target });
		assert('refused', res.success, false);
		assert('…with the not-in-a-timed-challenge message', res.error, "That team isn't in a timed challenge right now");
		assert('powerup stays held (not burned on a miss)', await statusOf(db, tpId), 'held');
		assert('no effect row on the target', (await effectsFor(db, target)).length, 0);
	}
}

// ── 4. Shield still absorbs it (the fase-2b seam, asserted once here) ─────────
async function verifyShieldBlocks(ctx: Ctx) {
	console.log('\n── Time Drain vs Shield: absorbed, caster still pays ─────────────');
	const { db, attacker, target, timer } = ctx;
	const tpId = await freshWorld(ctx);

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
	assert('a shield_block marker is written', rows.filter((r) => r.effect_type === 'shield_block').length, 1);
	assert('attacker still spends the powerup', await statusOf(db, tpId), 'consumed');
	assert('shield is spent too', await statusOf(db, shieldTp), 'consumed');
}

async function main() {
	loadEnv();
	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		console.error('Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
		process.exit(1);
	}
	const db = createClient(url, key);

	// Precondition, checked READ-ONLY and reported rather than silently fixed:
	// activatePowerup gates on game_sets.status === 'active' (powerups.ts:1953-1956),
	// and the documented soft-reset leaves the set 'inactive'. A harness that
	// flipped it itself would hide that from whoever runs it next.
	const { data: gs } = await db
		.from('game_sets')
		.select('status, play_state')
		.eq('id', SET_ID)
		.maybeSingle();
	if (gs?.status !== 'active') {
		console.error(
			`\nMechanics set is status=${gs?.status ?? '<missing>'} — activatePowerup refuses ` +
				`anything but 'active' (powerups.ts:1953).\n` +
				`Activate it first:  UPDATE game_sets SET status='active' WHERE id='${SET_ID}';\n`
		);
		process.exit(1);
	}
	console.log(`  set: ${SET_ID}  status=${gs.status}  play_state=${gs.play_state}`);

	// Two real teams, by their natural key.
	const { data: teams } = await db
		.from('teams')
		.select('id, color, display_name')
		.in('color', ['red', 'blue']);
	const attacker = (teams ?? []).find((t) => t.color === 'red');
	const target = (teams ?? []).find((t) => t.color === 'blue');
	if (!attacker || !target) {
		console.error('Need the red + blue teams to exist');
		process.exit(1);
	}

	const { data: ch } = await db
		.from('challenges')
		.select('timer_seconds')
		.eq('id', CHALLENGE_ID)
		.maybeSingle();
	const timer = (ch?.timer_seconds as number | null) ?? 0;
	if (timer <= 0) {
		console.error(`Challenge ${CHALLENGE_ID} is not timed — the whole harness needs a clock`);
		process.exit(1);
	}
	console.log(
		`  attacker: ${attacker.display_name} (${attacker.color})   ` +
			`target: ${target.display_name} (${target.color})   challenge timer: ${timer}s`
	);

	const ctx: Ctx = {
		db,
		attacker: attacker.id as string,
		target: target.id as string,
		attackerName: attacker.display_name as string,
		targetName: target.display_name as string,
		timer
	};

	await verifyLandsOnTarget(ctx);
	await verifyStacks(ctx);
	await verifyRefusals(ctx);
	await verifyShieldBlocks(ctx);

	// Leave the set clean for the next harness.
	await softReset(db);

	const failed = checks.filter((c) => !c.pass);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	if (failed.length) {
		for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
		process.exit(1);
	}
}

void main();
