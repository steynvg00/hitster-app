// Shared two-team OFFENSIVE fundament — extracted verbatim from
// verify-offensive-timedrain.ts (fase 2a) so fase 2b builds on it rather than
// beside it. Nothing here is new: it is the same soft-reset, the same derived
// deadline, the same grant/attempt helpers, now importable.
//
// ── Why these harnesses hit the real DB ──────────────────────────────────────
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
// computation can tell those apart. Hence: real DB, scoped to the Mechanics set.
//
// ── The activity_log trap ────────────────────────────────────────────────────
//
// activity_log is the one table softReset() below does NOT clear (CLAUDE.md's
// reset SQL deletes it; verify-regression/verify-earning's softReset
// deliberately does not, and this copies theirs). Callers must therefore measure
// the log as a DELTA across an activation, never as an absolute count — an
// absolute count passes on a virgin database and creeps upward on every run.
// logCount() below exists to be differenced, not to be asserted directly.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SET_ID = 'e5100000-0000-4000-8000-000000000001';
// A timed challenge from the Mechanics set (timer_seconds = 90, status active).
// Its timer is read from the DB in bootstrap() rather than assumed.
export const CHALLENGE_ID = 'e5100000-0000-4000-8000-000000000020';

// ── .env loader (only sets keys not already in the environment) ───────────────
export function loadEnv() {
	try {
		const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
		for (const line of raw.split('\n')) {
			const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
			if (!m) continue;
			let val = m[2].trim();
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
				val = val.slice(1, -1);
			}
			if (!(m[1] in process.env)) process.env[m[1]] = val;
		}
	} catch {
		/* no .env — rely on the real environment */
	}
}

// ── tiny assert harness (same shape as the other bots:verify-* scripts) ───────
export type Check = { name: string; pass: boolean; detail: string };
export const checks: Check[] = [];

export function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass ? JSON.stringify(got) : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
	});
	console.log(`  ${pass ? '✓' : '✗'} ${name}  ${checks[checks.length - 1].detail}`);
}

/** Print the tally and exit non-zero on any failure. */
export function reportAndExit() {
	const failed = checks.filter((c) => !c.pass);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	if (failed.length) {
		for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
		process.exit(1);
	}
}

/** Soft-reset scoped to the Mechanics set — mirrors reset.ts's operations. */
export async function softReset(db: SupabaseClient) {
	const { data: scRows } = await db.from('set_challenges').select('challenge_id').eq('set_id', SET_ID);
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
 *
 * This is strictly stronger than reading a column would have been — there IS no
 * deadline column; this is the number the auto-submit backstop actually races.
 */
export async function effectiveDeadlineMs(
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
export async function grantHeld(
	db: SupabaseClient,
	teamId: string,
	typeId: string
): Promise<string> {
	const { data, error } = await db
		.from('team_powerups')
		.insert({ team_id: teamId, set_id: SET_ID, powerup_type_id: typeId, status: 'held' })
		.select('id')
		.single();
	if (error || !data) throw new Error(`grantHeld(${typeId}) failed: ${error?.message}`);
	return data.id as string;
}

/** Open an attempt for `teamId` on `challengeId`, started `startedAgoMs` ago. */
export async function openAttempt(
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

export type Ctx = {
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
 * (challenge_id, team_id), migration 0014:16), attacker holds one `typeId`.
 *
 * `targetAttempt: false` leaves the TARGET with no attempt at all — the state
 * give_a_shot is still activatable in and the timer attacks are not.
 */
export async function freshWorld(
	ctx: Ctx,
	typeId: string,
	opts: { attackerAttempt?: boolean; targetAttempt?: boolean } = {}
): Promise<string> {
	const { db, attacker, target } = ctx;
	await softReset(db);
	if (opts.targetAttempt !== false) await openAttempt(db, target, CHALLENGE_ID);
	if (opts.attackerAttempt !== false) await openAttempt(db, attacker, CHALLENGE_ID);
	return grantHeld(db, attacker, typeId);
}

/** Every effect row a team currently carries in this set. */
export const effectsFor = async (db: SupabaseClient, teamId: string) =>
	(
		await db
			.from('team_effects')
			.select(
				'id, effect_type, payload, activated_at, consumed_at, consumed_challenge_id, source_team_powerup_id'
			)
			.eq('team_id', teamId)
			.eq('set_id', SET_ID)
	).data ?? [];

/**
 * How many `eventType` rows the activity log holds right now. MUST be
 * differenced across an activation, never asserted absolutely — see the header.
 */
export const logCount = async (db: SupabaseClient, eventType: string) =>
	(await db.from('activity_log').select('id').eq('event_type', eventType)).data?.length ?? 0;

/** The newest activity_log row of a given type. */
export const newestLog = async (db: SupabaseClient, eventType: string) =>
	(
		await db
			.from('activity_log')
			.select('event_type, team_id, payload')
			.eq('event_type', eventType)
			.order('created_at', { ascending: false })
			.limit(1)
	).data?.[0] ?? null;

export const statusOf = async (db: SupabaseClient, tpId: string) =>
	(await db.from('team_powerups').select('status').eq('id', tpId).maybeSingle()).data?.status ?? null;

/**
 * Env + preconditions + the two real teams + the challenge's real timer.
 *
 * The set precondition is checked READ-ONLY and reported rather than silently
 * fixed: activatePowerup gates on game_sets.status === 'active'
 * (powerups.ts:1962-1963), and the documented soft-reset leaves the set
 * 'inactive'. A harness that flipped it itself would hide that from whoever
 * runs it next.
 */
export async function bootstrap(): Promise<Ctx> {
	loadEnv();
	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		console.error('Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
		process.exit(1);
	}
	const db = createClient(url, key);

	const { data: gs } = await db
		.from('game_sets')
		.select('status, play_state')
		.eq('id', SET_ID)
		.maybeSingle();
	if (gs?.status !== 'active') {
		console.error(
			`\nMechanics set is status=${gs?.status ?? '<missing>'} — activatePowerup refuses ` +
				`anything but 'active' (powerups.ts:1962).\n` +
				`Activate it first:  UPDATE game_sets SET status='active' WHERE id='${SET_ID}';\n`
		);
		process.exit(1);
	}
	console.log(`  set: ${SET_ID}  status=${gs.status}  play_state=${gs.play_state}`);

	// Two real teams, by their natural key.
	const { data: teams } = await db.from('teams').select('id, color, display_name').in('color', ['red', 'blue']);
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

	return {
		db,
		attacker: attacker.id as string,
		target: target.id as string,
		attackerName: attacker.display_name as string,
		targetName: target.display_name as string,
		timer
	};
}
