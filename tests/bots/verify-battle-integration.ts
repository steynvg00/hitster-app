// Battle Mode INTEGRATION harness (stuk 1/3) — exercises the REAL resolveBattle
// against the live DB with multiple simulated teams.
//
//   npm run bots:verify-battle-integration
//
// The gap between the pure-math verify-battle (computeBattleRanking in isolation)
// and verify-regression (non-battle scoring unchanged): this proves the DB wiring
// end-to-end — battle_raw_score → resolveBattle → additive ladder bonus on
// teams.score, CAS idempotency, the batch crown recompute (+1 steal), and
// maybeResolveBattle's all-done detection against real attempt rows.
//
// How it drives the real code: tsx can't import resolveBattle (its $lib runtime
// imports only resolve inside Vite), so the harness seeds controlled state at the
// DB level (submissions with a chosen battle_raw_score + score, attempts with a
// chosen elapsed, teams.score = the "full challenge score already added at
// submit") and then POSTs the DEV-only /api/dev/battle-resolve endpoint to run the
// REAL resolveBattle / maybeResolveBattle in-app. Seeding the submit side lets us
// assert against exact numbers (precision the browser can't give); the resolution
// side is the genuine production code path.
//
// Oracle: expected ranks/awards are hand-written per scenario (NOT computed via
// computeBattleRanking) so the test can't be circular.
//
// FIXTURE HYGIENE (the ch20-pollution lesson): ch20's points_config is snapshotted
// before the run and restored in a finally; battle state is reset before AND after.
// Run twice — the second run must be identical, no drift.
//
// Requires: app running (BOT_BASE_URL) with migration 0061 applied.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TEAM_COLOR_ORDER } from '../../src/lib/server/randomize';
import { BOT_BASE_URL } from './config';

function loadEnv() {
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
		/* rely on the real environment */
	}
}

const SET_ID = 'e5100000-0000-4000-8000-000000000001';
const BATTLE_CH = 'e5100000-0000-4000-8000-000000000020'; // ch20 — the dedicated battle challenge for this run
const LADDER = [10, 7, 5, 3, 1, 0];
const ATTEMPT_BASE = new Date('2024-01-01T00:00:00.000Z').getTime(); // absolute time is irrelevant; only ended−started matters

// ─── report plumbing ──────────────────────────────────────────────────────────
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass ? `${JSON.stringify(got)}` : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
	});
}

// ─── DB helpers ─────────────────────────────────────────────────────────────
type Team = { id: string; color: string };

async function scopedTeams(db: SupabaseClient): Promise<Team[]> {
	const { data: gs } = await db
		.from('game_sets')
		.select('team_count')
		.eq('id', SET_ID)
		.maybeSingle();
	const teamCount = (gs?.team_count as number | undefined) ?? 6;
	const colors = TEAM_COLOR_ORDER.slice(0, teamCount);
	const { data: teams } = await db.from('teams').select('id, color').in('color', colors);
	// Preserve TEAM_COLOR_ORDER (getTeamsInSet does — the crown tiebreak relies on it).
	return colors
		.map((c) => (teams ?? []).find((t) => t.color === c))
		.filter((t): t is { id: string; color: string } => t != null)
		.map((t) => ({ id: t.id, color: t.color }));
}

/** Clear all battle-relevant state so each scenario starts clean. */
async function resetBattle(db: SupabaseClient, teams: Team[]) {
	const teamIds = teams.map((t) => t.id);
	await db.from('submissions').delete().eq('challenge_id', BATTLE_CH);
	await db.from('challenge_attempts').delete().eq('challenge_id', BATTLE_CH);
	await db
		.from('teams')
		.update({ score: 0, current_streak: 0 })
		.in('id', teamIds);
	await db
		.from('set_challenges')
		.update({ battle_resolved_at: null, battle_ranking: null })
		.eq('set_id', SET_ID)
		.eq('challenge_id', BATTLE_CH);
	await db
		.from('game_sets')
		.update({ crown_holder_team_id: null, crown_payout_applied: false })
		.eq('id', SET_ID);
	// Clear prior battle activity logs so per-scenario crown-log counts are clean.
	await db.from('activity_log').delete().in('team_id', teamIds).eq('event_type', 'battle_award');
	await db.from('activity_log').delete().in('team_id', teamIds).eq('event_type', 'crown_stolen');
}

/** Simulate a team having submitted the battle challenge: attempt + submission +
 *  the full challenge score already added to teams.score at submit. */
async function seedSubmission(
	db: SupabaseClient,
	teamId: string,
	opts: { raw: number; full: number; elapsedSec: number }
) {
	const startedAt = new Date(ATTEMPT_BASE).toISOString();
	const endedAt = new Date(ATTEMPT_BASE + opts.elapsedSec * 1000).toISOString();
	await db
		.from('challenge_attempts')
		.insert({ challenge_id: BATTLE_CH, team_id: teamId, started_at: startedAt, ended_at: endedAt });
	await db.from('submissions').insert({
		challenge_id: BATTLE_CH,
		team_id: teamId,
		answers: [],
		score: opts.full,
		is_final: true,
		battle_raw_score: opts.raw
	});
	await db.from('teams').update({ score: opts.full }).eq('id', teamId);
}

async function teamScore(db: SupabaseClient, teamId: string): Promise<number> {
	const { data } = await db.from('teams').select('score').eq('id', teamId).maybeSingle();
	return (data?.score as number | undefined) ?? -1;
}

async function battleRanking(db: SupabaseClient): Promise<Array<Record<string, unknown>>> {
	const { data } = await db
		.from('set_challenges')
		.select('battle_ranking')
		.eq('set_id', SET_ID)
		.eq('challenge_id', BATTLE_CH)
		.maybeSingle();
	return (data?.battle_ranking as Array<Record<string, unknown>> | null) ?? [];
}

async function resolvedAt(db: SupabaseClient): Promise<string | null> {
	const { data } = await db
		.from('set_challenges')
		.select('battle_resolved_at')
		.eq('set_id', SET_ID)
		.eq('challenge_id', BATTLE_CH)
		.maybeSingle();
	return (data?.battle_resolved_at as string | null) ?? null;
}

async function crownHolder(db: SupabaseClient): Promise<string | null> {
	const { data } = await db
		.from('game_sets')
		.select('crown_holder_team_id')
		.eq('id', SET_ID)
		.maybeSingle();
	return (data?.crown_holder_team_id as string | null) ?? null;
}

async function battleCrownLogCount(db: SupabaseClient, teamIds: string[]): Promise<number> {
	const { data } = await db
		.from('activity_log')
		.select('payload')
		.eq('event_type', 'crown_stolen')
		.in('team_id', teamIds);
	return (data ?? []).filter((r) => (r.payload as { via?: string } | null)?.via === 'battle').length;
}

async function setCrown(db: SupabaseClient, teamId: string) {
	await db.from('game_sets').update({ crown_holder_team_id: teamId }).eq('id', SET_ID);
}

async function callResolve(mode: 'resolve' | 'maybe'): Promise<Record<string, unknown>> {
	const res = await fetch(`${BOT_BASE_URL}/api/dev/battle-resolve`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ setId: SET_ID, challengeId: BATTLE_CH, mode })
	});
	return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

const awardFor = (ranking: Array<Record<string, unknown>>, teamId: string) =>
	ranking.find((r) => r.team_id === teamId)?.awarded ?? null;
const rankFor = (ranking: Array<Record<string, unknown>>, teamId: string) =>
	ranking.find((r) => r.team_id === teamId)?.rank ?? null;

// ─── scenarios ────────────────────────────────────────────────────────────────
// t[0]=blue t[1]=yellow t[2]=green t[3]=red (TEAM_COLOR_ORDER for team_count 4)

async function s1CleanAdditive(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	// Distinct raws → distinct ranks. Pre-seat the crown on blue (already the
	// pre-battle leader by full score) so the recompute is a no-op → deltas are
	// PURE ladder, no +1 noise.
	await seedSubmission(db, t[0].id, { raw: 20, full: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { raw: 15, full: 20, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { raw: 10, full: 12, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { raw: 0, full: 0, elapsedSec: 30 }); // played, empty
	await setCrown(db, t[0].id);

	const before = [await teamScore(db, t[0].id), await teamScore(db, t[1].id), await teamScore(db, t[2].id), await teamScore(db, t[3].id)];
	await callResolve('resolve');
	const after = [await teamScore(db, t[0].id), await teamScore(db, t[1].id), await teamScore(db, t[2].id), await teamScore(db, t[3].id)];

	// Oracle: raws 20>15>10>0 → ranks 1..4 → ladder [10,7,5,3].
	assert('S1 additive Δ blue == ladder[0] (10)', after[0] - before[0], 10);
	assert('S1 additive Δ yellow == ladder[1] (7)', after[1] - before[1], 7);
	assert('S1 additive Δ green == ladder[2] (5)', after[2] - before[2], 5);
	assert('S1 additive Δ red == ladder[3] (3)', after[3] - before[3], 3);
	const r = await battleRanking(db);
	assert('S1 ranking blue rank1/award10', [rankFor(r, t[0].id), awardFor(r, t[0].id)], [1, 10]);
	assert('S1 ranking red rank4/award3', [rankFor(r, t[3].id), awardFor(r, t[3].id)], [4, 3]);
	assert('S1 battle_resolved_at set', (await resolvedAt(db)) != null, true);
	// Crown was already blue and blue stays top → no transfer, no battle +1.
	assert('S1 crown stays blue', await crownHolder(db), t[0].id);
	assert('S1 no battle crown log (holder unchanged)', await battleCrownLogCount(db, t.map((x) => x.id)), 0);
}

async function s2SpeedTiebreak(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	// blue & yellow tie on raw 15; blue faster (20s) than yellow (40s) → distinct.
	await seedSubmission(db, t[0].id, { raw: 15, full: 30, elapsedSec: 20 });
	await seedSubmission(db, t[1].id, { raw: 15, full: 20, elapsedSec: 40 });
	await seedSubmission(db, t[2].id, { raw: 10, full: 12, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { raw: 5, full: 6, elapsedSec: 30 });
	await setCrown(db, t[0].id); // blue stays top (30+10) → no +1

	await callResolve('resolve');
	const r = await battleRanking(db);
	assert('S2 faster blue rank1/award10', [rankFor(r, t[0].id), awardFor(r, t[0].id)], [1, 10]);
	assert('S2 slower yellow rank2/award7 (distinct, not split)', [rankFor(r, t[1].id), awardFor(r, t[1].id)], [2, 7]);
	assert('S2 green rank3/award5', [rankFor(r, t[2].id), awardFor(r, t[2].id)], [3, 5]);
}

async function s3AverageSplit(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	// blue & yellow identical raw 15 AND identical elapsed 30 → share avg((10+7)/2)=9.
	await seedSubmission(db, t[0].id, { raw: 15, full: 30, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { raw: 15, full: 28, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { raw: 10, full: 12, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { raw: 5, full: 6, elapsedSec: 30 });
	await setCrown(db, t[0].id); // blue stays top → no +1

	await callResolve('resolve');
	const r = await battleRanking(db);
	assert('S3 blue split award 9', awardFor(r, t[0].id), 9);
	assert('S3 yellow split award 9', awardFor(r, t[1].id), 9);
	assert('S3 blue+yellow share rank 1', [rankFor(r, t[0].id), rankFor(r, t[1].id)], [1, 1]);
	assert('S3 green rank3/award5', [rankFor(r, t[2].id), awardFor(r, t[2].id)], [3, 5]);
}

async function s4NonParticipant(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	// red has NO attempt/submission → the auto-hook wouldn't fire; resolve directly
	// (the host-resolve path). red ranks last at raw 0 with elapsed ∞.
	await seedSubmission(db, t[0].id, { raw: 20, full: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { raw: 10, full: 12, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { raw: 5, full: 6, elapsedSec: 30 });
	// t[3] (red): nothing seeded, score stays 0
	await setCrown(db, t[0].id);

	const redBefore = await teamScore(db, t[3].id);
	await callResolve('resolve');
	const r = await battleRanking(db);
	// Oracle: 4 teams → last position is index 3 → ladder[3]=3 (NOT 0; 0 is index 5).
	assert('S4 non-participant red rank4/award3 (last ladder slot)', [rankFor(r, t[3].id), awardFor(r, t[3].id)], [4, 3]);
	assert('S4 non-participant raw_score 0', r.find((x) => x.team_id === t[3].id)?.raw_score, 0);
	assert('S4 non-participant elapsed null', r.find((x) => x.team_id === t[3].id)?.elapsed_seconds, null);
	assert('S4 non-participant Δ == 3', (await teamScore(db, t[3].id)) - redBefore, 3);
}

async function s5Idempotency(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	await seedSubmission(db, t[0].id, { raw: 20, full: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { raw: 10, full: 12, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { raw: 5, full: 6, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { raw: 0, full: 0, elapsedSec: 30 });
	await setCrown(db, t[0].id); // blue stays top → no +1, so no crown noise across the two calls

	await callResolve('resolve');
	const after1 = [await teamScore(db, t[0].id), await teamScore(db, t[1].id), await teamScore(db, t[2].id), await teamScore(db, t[3].id)];
	const resolvedAt1 = await resolvedAt(db);

	const res2 = await callResolve('resolve'); // second call must be a no-op (CAS lost)
	const after2 = [await teamScore(db, t[0].id), await teamScore(db, t[1].id), await teamScore(db, t[2].id), await teamScore(db, t[3].id)];
	const resolvedAt2 = await resolvedAt(db);

	assert('S5 second resolve reports resolved:false', res2.resolved, false);
	assert('S5 scores unchanged after 2nd call', after2, after1);
	assert('S5 battle_resolved_at unchanged (claimed once)', resolvedAt2, resolvedAt1);
	// Sanity: the ONE award happened (blue got its +10 on the first call).
	assert('S5 blue = full 40 + ladder 10 (added exactly once)', after1[0], 50);
}

async function s6CrownChange(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	// Pre-battle crown holder = yellow (t[1]). After ladder adds blue overtakes by 1.
	//   blue:   full 30 + ladder[0] 10  = 40
	//   yellow: full 32 + ladder[1] 7   = 39   (was crown holder)
	//   green:  full 10 + ladder[2] 5   = 15
	//   red:    full 0  + ladder[3] 3   = 3
	// blue 40 > holder yellow 39 → crown → blue, +1 steal → blue 41. Exactly one log.
	await seedSubmission(db, t[0].id, { raw: 20, full: 30, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { raw: 10, full: 32, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { raw: 5, full: 10, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { raw: 0, full: 0, elapsedSec: 30 });
	await setCrown(db, t[1].id); // yellow holds pre-battle

	await callResolve('resolve');
	assert('S6 crown moved to blue', await crownHolder(db), t[0].id);
	assert('S6 blue = 30 + 10 + 1 steal = 41', await teamScore(db, t[0].id), 41);
	assert('S6 yellow unchanged at 39 (no steal)', await teamScore(db, t[1].id), 39);
	assert('S6 exactly ONE battle crown log', await battleCrownLogCount(db, t.map((x) => x.id)), 1);
}

async function s7AutoHook(db: SupabaseClient, t: Team[]) {
	// (a) All four teams finished → maybeResolveBattle must resolve automatically.
	await resetBattle(db, t);
	await seedSubmission(db, t[0].id, { raw: 20, full: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { raw: 15, full: 20, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { raw: 10, full: 12, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { raw: 5, full: 6, elapsedSec: 30 });
	await setCrown(db, t[0].id);
	await callResolve('maybe');
	assert('S7a all-done → auto-resolved (battle_resolved_at set)', (await resolvedAt(db)) != null, true);
	assert('S7a auto-resolve applied ladder (blue 40+10=50)', await teamScore(db, t[0].id), 50);

	// (b) One team never started → maybeResolveBattle must NOT resolve.
	await resetBattle(db, t);
	await seedSubmission(db, t[0].id, { raw: 20, full: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { raw: 15, full: 20, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { raw: 10, full: 12, elapsedSec: 30 });
	// t[3] (red) has no attempt
	await callResolve('maybe');
	assert('S7b partial turnout → NOT resolved (battle_resolved_at null)', await resolvedAt(db), null);
	assert('S7b partial turnout → no ladder added (blue still 40)', await teamScore(db, t[0].id), 40);
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
	loadEnv();
	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error('Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
	const db = createClient(url, key, { auth: { persistSession: false } });

	console.log(`▶ Battle integration verification against ${BOT_BASE_URL}`);
	console.log(`  set: ${SET_ID}  battle challenge: ${BATTLE_CH} (ch20)\n`);

	const teams = await scopedTeams(db);
	if (teams.length < 4) throw new Error(`Expected 4 scoped teams, got ${teams.length}`);

	// Snapshot ch20's points_config — RESTORED in finally (fixture hygiene).
	const { data: chBefore } = await db
		.from('challenges')
		.select('points_config')
		.eq('id', BATTLE_CH)
		.maybeSingle();
	const originalConfig = chBefore?.points_config ?? null;

	try {
		// Make ch20 a battle challenge for the run.
		await db
			.from('challenges')
			.update({ points_config: { battle: { enabled: true, ladder: LADDER } } })
			.eq('id', BATTLE_CH);

		await s1CleanAdditive(db, teams);
		await s2SpeedTiebreak(db, teams);
		await s3AverageSplit(db, teams);
		await s4NonParticipant(db, teams);
		await s5Idempotency(db, teams);
		await s6CrownChange(db, teams);
		await s7AutoHook(db, teams);
	} finally {
		// Restore ch20's exact original config + wipe all battle/game state we touched.
		await resetBattle(db, teams);
		await db
			.from('challenges')
			.update({ points_config: originalConfig as never })
			.eq('id', BATTLE_CH);
		console.log('↩ restored ch20 points_config + reset battle state\n');
	}

	console.log('─── Results ───');
	for (const c of checks) {
		console.log(`  ${c.pass ? '✅' : '❌'} ${c.name.padEnd(52)} ${c.pass ? '' : c.detail}`);
	}
	const passed = checks.filter((c) => c.pass).length;
	console.log(`\n${passed}/${checks.length} checks passed`);
	if (passed !== checks.length) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
