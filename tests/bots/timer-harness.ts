// Shared TIME-MANIPULATION fundament for the auto-submit backstop harness
// (fase 3a). Fase 3b (resurrection-attempt, lifeline-gate) builds on this.
//
// ── Why a harness cannot simply wait ─────────────────────────────────────────
//
// The backstop only claims an attempt once its deadline PLUS a 20 s grace window
// has passed. A challenge timer in the Mechanics set is 90 s, so an honest test
// would sit still for ~110 s per case — and the game-set timer is 3600 s, which
// no test can wait for at all.
//
// The technique instead: `challenge_attempts.started_at` and
// `game_sets.started_at` are the ONLY inputs to both deadline computations. Push
// them into the past and the server sees an elapsed clock without a second of
// real waiting. Precedent for writing these columns directly:
// verify-regression.ts:363 (`.update({ started_at: past })`) and
// offensive-harness.ts:174-188 (`openAttempt` inserts a backdated started_at).
// challenge_attempts is unique on the PAIR (challenge_id, team_id) —
// 0014_...sql:16 — so one attempt per team per challenge, which is what lets
// several teams sit on the same challenge in different timer states at once.
//
// ── Why the deadline oracle is written out by hand ───────────────────────────
//
// Every expectation below is derived from the SPEC, never by importing or
// re-reading the server's own constants. If auto-submit's grace window silently
// changed, an oracle that imported GRACE_MS would move with it and stay green.
// ORACLE_GRACE_MS is therefore a local literal, and FALSIFY exists to prove that
// literal actually binds the assertions (see falsifyMode()).
//
// ── Why this must go over HTTP ───────────────────────────────────────────────
//
// The backstop logic is not an exported function: it lives inline in the
// `POST: RequestHandler` at auto-submit/+server.ts:8. Importing that module from
// tsx is impossible — its dependency chain reaches lib/server/supabase.ts:3-4,
// which imports `$env/static/public` / `$env/static/private`, Vite virtual
// modules that plain esbuild cannot resolve (no file under tests/bots imports
// `$lib` for exactly this reason). So the harness POSTs the real endpoint on a
// running dev server, the same call verify-regression.ts:366 already makes. The
// admin guard at +server.ts:9 is satisfied in DEV by hooks.server.ts:26-31.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv, SET_ID } from './offensive-harness';
import { BOT_BASE_URL } from './config';

export { SET_ID };

/** The other real set on this database. Never written to; asserted untouched. */
export const FOREIGN_SET_ID = '72ee8093-844d-4393-ae86-8ff6c820de9b';

/**
 * INDEPENDENT ORACLE CONSTANT — hand-copied from the spec, deliberately NOT
 * imported from the server. auto-submit/+server.ts:64 declares the same value;
 * if the two ever disagree the assertions go red, which is the entire point.
 */
export const ORACLE_GRACE_MS = 20_000;

/**
 * Falsification switch. `FALSIFY=grace` drops the oracle's grace window to 0,
 * which must turn the "just before the claim point" case RED — proof that the
 * expectations are bound to the number above rather than to whatever the server
 * happens to do. Any other value runs the harness honestly.
 */
export function falsifyMode(): string | null {
	return process.env.FALSIFY ?? null;
}

export function oracleGraceMs(): number {
	return falsifyMode() === 'grace' ? 0 : ORACLE_GRACE_MS;
}

/**
 * SECTION 1 ORACLE — the moment the backstop is allowed to claim an attempt.
 *
 *   started_at + (seconds + Σ added_seconds) * 1000 + GRACE
 *
 * where `seconds` is the attempt's own `timer_override_seconds` when it has one,
 * else the challenge's `timer_seconds`, and Σ runs over the team's
 * time_boost / freeze / time_drain rows whose payload.challenge_id matches
 * (boost/freeze = +30, drain = −15). Written from the spec; the server computes
 * the same thing at +server.ts:65-75.
 *
 * An attempt is claimable iff this instant is strictly in the past.
 */
export function oracleClaimAtMs(opts: {
	startedAtMs: number;
	timerSeconds: number;
	overrideSeconds?: number | null;
	addedSeconds?: number;
}): number {
	const seconds = opts.overrideSeconds ?? opts.timerSeconds;
	const added = opts.addedSeconds ?? 0;
	return opts.startedAtMs + (seconds + added) * 1000 + oracleGraceMs();
}

/** Does the oracle expect this attempt to be claimed by a fire at `nowMs`? */
export function oracleExpectsClaim(
	opts: Parameters<typeof oracleClaimAtMs>[0] & { nowMs: number }
): boolean {
	return oracleClaimAtMs(opts) < opts.nowMs;
}

/**
 * SECTION 2 ORACLE — when a game set's total timer is up.
 *
 *   started_at + total_timer_seconds * 1000,  flip iff now >= that
 *
 * Note the deliberate asymmetry with section 1: there is NO grace window here
 * and the comparison is inclusive (+server.ts:200-201). Two different formulas,
 * kept apart on purpose so one cannot paper over the other.
 */
export function oracleSetFlipDueMs(startedAtMs: number, totalTimerSeconds: number): number {
	return startedAtMs + totalTimerSeconds * 1000;
}

export function oracleExpectsFlip(
	startedAtMs: number,
	totalTimerSeconds: number,
	nowMs: number
): boolean {
	return nowMs >= oracleSetFlipDueMs(startedAtMs, totalTimerSeconds);
}

// ── time manipulation ────────────────────────────────────────────────────────

/**
 * Put a team's attempt on `challengeId` exactly `secondsAgo` seconds into the
 * past, creating it if absent and re-opening it if a previous fire closed it.
 *
 * Callers re-position immediately BEFORE each fire rather than once at setup:
 * the offsets here straddle the claim point by seconds, and the wall-clock time
 * spent on an HTTP round trip between two fires would otherwise drift a
 * "just before" case across the boundary and flake.
 */
export async function positionAttempt(
	db: SupabaseClient,
	opts: {
		teamId: string;
		challengeId: string;
		secondsAgo: number;
		overrideSeconds?: number | null;
	}
): Promise<{ attemptId: string; startedAtMs: number }> {
	const startedAtMs = Date.now() - opts.secondsAgo * 1000;
	const { data, error } = await db
		.from('challenge_attempts')
		.upsert(
			{
				challenge_id: opts.challengeId,
				team_id: opts.teamId,
				started_at: new Date(startedAtMs).toISOString(),
				ended_at: null,
				timer_override_seconds: opts.overrideSeconds ?? null
			},
			{ onConflict: 'challenge_id,team_id' }
		)
		.select('id')
		.single();
	if (error || !data) throw new Error(`positionAttempt failed: ${error?.message}`);
	return { attemptId: data.id as string, startedAtMs };
}

/**
 * Insert a timer effect the way the runtime does: a payload-driven marker row
 * carrying { added_seconds, challenge_id }, matched by the backstop on team +
 * payload.challenge_id and SUMmed (+server.ts:42-55). time_boost = +30.
 */
export async function grantTimerEffect(
	db: SupabaseClient,
	opts: {
		teamId: string;
		challengeId: string;
		effectType: 'time_boost' | 'freeze' | 'time_drain';
		addedSeconds: number;
	}
): Promise<string> {
	const { data, error } = await db
		.from('team_effects')
		.insert({
			team_id: opts.teamId,
			set_id: SET_ID,
			effect_type: opts.effectType,
			payload: { added_seconds: opts.addedSeconds, challenge_id: opts.challengeId },
			consumed_at: new Date().toISOString()
		})
		.select('id')
		.single();
	if (error || !data) throw new Error(`grantTimerEffect failed: ${error?.message}`);
	return data.id as string;
}

/** Move a game set's own clock. `startedSecondsAgo: null` clears it entirely. */
export async function positionSetClock(
	db: SupabaseClient,
	opts: { playState: string; startedSecondsAgo: number | null }
): Promise<number | null> {
	const startedAtMs =
		opts.startedSecondsAgo === null ? null : Date.now() - opts.startedSecondsAgo * 1000;
	const { error } = await db
		.from('game_sets')
		.update({
			play_state: opts.playState,
			started_at: startedAtMs === null ? null : new Date(startedAtMs).toISOString(),
			ended_at: null
		})
		.eq('id', SET_ID);
	if (error) throw new Error(`positionSetClock failed: ${error.message}`);
	return startedAtMs;
}

// ── firing the backstop ──────────────────────────────────────────────────────

export type FireResult = { ok: boolean; status: number; created: number | null; nowMs: number };

/**
 * POST /api/auto-submit and report what came back. `nowMs` is stamped just
 * before the request so oracles compare against the instant the server saw,
 * not against a later read.
 */
export async function fireAutoSubmit(): Promise<FireResult> {
	const nowMs = Date.now();
	const res = await fetch(`${BOT_BASE_URL}/api/auto-submit`, { method: 'POST' });
	let created: number | null = null;
	try {
		const body = (await res.json()) as { created?: number };
		created = typeof body.created === 'number' ? body.created : null;
	} catch {
		/* non-JSON body (403 page etc.) — status carries the story */
	}
	return { ok: res.ok, status: res.status, created, nowMs };
}

/** Fail fast with instructions rather than producing a wall of red. */
export async function requireDevServer(): Promise<void> {
	try {
		const res = await fetch(`${BOT_BASE_URL}/api/auto-submit`, { method: 'POST' });
		if (res.status === 403) {
			console.error(
				`\n${BOT_BASE_URL}/api/auto-submit answered 403 — the DEV admin bypass ` +
					`(hooks.server.ts:26-31) did not resolve a host user.\n` +
					`The endpoint must be reachable as an admin for this harness to run.\n`
			);
			process.exit(1);
		}
	} catch {
		console.error(
			`\nNo app reachable at ${BOT_BASE_URL}.\n` +
				`The backstop lives inline in a SvelteKit RequestHandler and cannot be ` +
				`imported from tsx (its chain pulls $env/static/*), so this harness needs ` +
				`the real endpoint:\n\n    npm run dev\n\n` +
				`Then re-run. Override the base URL with BOT_BASE_URL.\n`
		);
		process.exit(1);
	}
}

// ── reading state back ───────────────────────────────────────────────────────

export type AttemptState = { ended: boolean; startedAtMs: number | null };

export async function readAttempt(
	db: SupabaseClient,
	teamId: string,
	challengeId: string
): Promise<AttemptState | null> {
	const { data } = await db
		.from('challenge_attempts')
		.select('started_at, ended_at')
		.eq('challenge_id', challengeId)
		.eq('team_id', teamId)
		.maybeSingle();
	if (!data) return null;
	return {
		ended: data.ended_at != null,
		startedAtMs: data.started_at ? new Date(data.started_at as string).getTime() : null
	};
}

export type SubmissionState = { isFinal: boolean; score: number | null };

export async function readSubmission(
	db: SupabaseClient,
	teamId: string,
	challengeId: string
): Promise<SubmissionState | null> {
	const { data } = await db
		.from('submissions')
		.select('is_final, score')
		.eq('challenge_id', challengeId)
		.eq('team_id', teamId)
		.maybeSingle();
	if (!data) return null;
	return { isFinal: data.is_final === true, score: (data.score as number | null) ?? null };
}

export async function readSet(db: SupabaseClient, setId: string) {
	const { data } = await db
		.from('game_sets')
		.select('status, play_state, started_at, ended_at, total_timer_seconds')
		.eq('id', setId)
		.maybeSingle();
	return data;
}

/** Open attempts across the WHOLE database — section 1's scope is global. */
export async function globalOpenAttemptCount(db: SupabaseClient): Promise<number> {
	const { count } = await db
		.from('challenge_attempts')
		.select('id', { count: 'exact', head: true })
		.is('ended_at', null);
	return count ?? 0;
}

/**
 * activity_log snapshot, to be DIFFERENCED. Never assert an absolute count: the
 * table survives softReset, so an absolute expectation passes on a virgin
 * database and creeps on every later run (the fase 2a lesson —
 * offensive-harness.ts:23-30).
 */
export async function logCounts(
	db: SupabaseClient,
	eventTypes: string[]
): Promise<Record<string, number>> {
	const out: Record<string, number> = {};
	for (const t of eventTypes) {
		const { count } = await db
			.from('activity_log')
			.select('id', { count: 'exact', head: true })
			.eq('event_type', t);
		out[t] = count ?? 0;
	}
	return out;
}

export function logDelta(before: Record<string, number>, after: Record<string, number>) {
	const out: Record<string, number> = {};
	for (const k of Object.keys(after)) out[k] = (after[k] ?? 0) - (before[k] ?? 0);
	return out;
}

// ── bootstrap ────────────────────────────────────────────────────────────────

export type TimerCtx = {
	db: SupabaseClient;
	teams: { id: string; color: string; name: string }[];
	challengeIds: string[];
	timerSeconds: number;
	setTotalTimerSeconds: number;
};

/**
 * Env, dev server, and the read-only preconditions.
 *
 * The set's status/play_state are REPORTED, not silently fixed — the same stance
 * offensive-harness.ts:252-260 takes, so whoever runs this next can see the
 * state they inherited.
 */
export async function bootstrapTimer(): Promise<TimerCtx> {
	loadEnv();
	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		console.error('Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
		process.exit(1);
	}
	const db = createClient(url, key);
	await requireDevServer();

	const set = await readSet(db, SET_ID);
	if (set?.status !== 'active') {
		console.error(
			`\nMechanics set is status=${set?.status ?? '<missing>'} — expected 'active'.\n` +
				`Activate it first:  UPDATE game_sets SET status='active' WHERE id='${SET_ID}';\n`
		);
		process.exit(1);
	}
	const totalTimer = (set.total_timer_seconds as number | null) ?? 0;
	if (totalTimer <= 0) {
		console.error(`Mechanics set has no total_timer_seconds — section 2 needs one`);
		process.exit(1);
	}
	console.log(
		`  set: ${SET_ID}  status=${set.status}  play_state=${set.play_state}  ` +
			`total_timer=${totalTimer}s  started_at=${set.started_at ?? 'null'}`
	);

	// The OTHER real set on this database. Reported so a reader can see the
	// harness knows about it; every phase asserts it stays untouched.
	const foreign = await readSet(db, FOREIGN_SET_ID);
	console.log(
		`  foreign set (never written): ${FOREIGN_SET_ID}  status=${foreign?.status}  ` +
			`play_state=${foreign?.play_state}`
	);

	const { data: teamRows } = await db
		.from('teams')
		.select('id, color, display_name')
		.order('color');
	const teams = (teamRows ?? []).map((t) => ({
		id: t.id as string,
		color: t.color as string,
		name: t.display_name as string
	}));
	if (teams.length < 4) {
		console.error(`Need at least 4 teams; found ${teams.length}`);
		process.exit(1);
	}

	const { data: scRows } = await db
		.from('set_challenges')
		.select('challenge_id')
		.eq('set_id', SET_ID);
	const ids = [...new Set((scRows ?? []).map((r) => r.challenge_id as string))];
	const { data: chRows } = await db
		.from('challenges')
		.select('id, timer_seconds')
		.in('id', ids)
		.gt('timer_seconds', 0)
		.order('id');

	// A challenge only produces a submission when it has tabs — without them the
	// backstop closes the attempt and moves on (+server.ts:152-157), which would
	// make a "submission created" assertion fail for the wrong reason.
	const { data: tabRows } = await db
		.from('challenge_tabs')
		.select('challenge_id')
		.in(
			'challenge_id',
			(chRows ?? []).map((c) => c.id as string)
		);
	const withTabs = new Set((tabRows ?? []).map((t) => t.challenge_id as string));
	const usable = (chRows ?? []).filter((c) => withTabs.has(c.id as string));
	if (usable.length < 1) {
		console.error('No timed challenge with tabs in the Mechanics set');
		process.exit(1);
	}
	const timerSeconds = usable[0].timer_seconds as number;
	if (usable.some((c) => c.timer_seconds !== timerSeconds)) {
		console.log('  note: mixed timer_seconds in set — each case reads its own challenge timer');
	}
	console.log(
		`  teams: ${teams.length}   timed challenges with tabs: ${usable.length}   ` +
			`challenge timer: ${timerSeconds}s`
	);
	if (falsifyMode()) {
		console.log(
			`\n  ⚠ FALSIFY=${falsifyMode()} — oracle deliberately wrong; RED is the expected result\n`
		);
	}

	return {
		db,
		teams,
		challengeIds: usable.map((c) => c.id as string),
		timerSeconds,
		setTotalTimerSeconds: totalTimer
	};
}
