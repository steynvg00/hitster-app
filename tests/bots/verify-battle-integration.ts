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
// Ladder model (stuk 2): the seeded battle config is now { enabled, max_points } —
// no stored ladder. The expected awards below are computed via deriveLadder(
// MAX_POINTS, teams.length), the SAME derivation resolveBattle itself calls, so
// this proves the DB wiring (CAS, crown, idempotency) against the real derived
// ladder for the set's actual team_count rather than a stale hand-written array.
//
// Requires: app running (BOT_BASE_URL) with migration 0061 applied.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TEAM_COLOR_ORDER } from '../../src/lib/server/randomize';
import { deriveLadder } from '../../src/lib/battle-ranking';
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
const MAX_POINTS = 10;
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

/** Runs the REAL resolveBattlesForRecap — the same set-wide barrier startRecap and
 *  the auto-submit recap flip call. Set-scoped: no challengeId. */
async function callRecapBarrier(): Promise<Record<string, unknown>> {
	const res = await fetch(`${BOT_BASE_URL}/api/dev/battle-resolve`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ setId: SET_ID, mode: 'recap-barrier' })
	});
	return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

const awardFor = (ranking: Array<Record<string, unknown>>, teamId: string) =>
	ranking.find((r) => r.team_id === teamId)?.awarded ?? null;
const rankFor = (ranking: Array<Record<string, unknown>>, teamId: string) =>
	ranking.find((r) => r.team_id === teamId)?.rank ?? null;

// ─── scenarios ────────────────────────────────────────────────────────────────
// t[0]=blue t[1]=yellow t[2]=green t[3]=red (TEAM_COLOR_ORDER for team_count 4)

async function s1CleanAdditive(db: SupabaseClient, t: Team[], L: number[]) {
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

	// Oracle: raws 20>15>10>0 → ranks 1..4 → derived ladder L (e.g. [10,7,3,0] for M=10,N=4).
	assert('S1 additive Δ blue == L[0]', after[0] - before[0], L[0]);
	assert('S1 additive Δ yellow == L[1]', after[1] - before[1], L[1]);
	assert('S1 additive Δ green == L[2]', after[2] - before[2], L[2]);
	assert('S1 additive Δ red == L[3]', after[3] - before[3], L[3]);
	const r = await battleRanking(db);
	assert('S1 ranking blue rank1/award L[0]', [rankFor(r, t[0].id), awardFor(r, t[0].id)], [1, L[0]]);
	assert('S1 ranking red rank4/award L[3]', [rankFor(r, t[3].id), awardFor(r, t[3].id)], [4, L[3]]);
	assert('S1 battle_resolved_at set', (await resolvedAt(db)) != null, true);
	// Crown was already blue and blue stays top → no transfer, no battle +1.
	assert('S1 crown stays blue', await crownHolder(db), t[0].id);
	assert('S1 no battle crown log (holder unchanged)', await battleCrownLogCount(db, t.map((x) => x.id)), 0);
}

async function s2SpeedTiebreak(db: SupabaseClient, t: Team[], L: number[]) {
	await resetBattle(db, t);
	// blue & yellow tie on raw 15; blue faster (20s) than yellow (40s) → distinct.
	await seedSubmission(db, t[0].id, { raw: 15, full: 30, elapsedSec: 20 });
	await seedSubmission(db, t[1].id, { raw: 15, full: 20, elapsedSec: 40 });
	await seedSubmission(db, t[2].id, { raw: 10, full: 12, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { raw: 5, full: 6, elapsedSec: 30 });
	await setCrown(db, t[0].id); // blue stays top (30+L[0]) → no +1

	await callResolve('resolve');
	const r = await battleRanking(db);
	assert('S2 faster blue rank1/award L[0]', [rankFor(r, t[0].id), awardFor(r, t[0].id)], [1, L[0]]);
	assert('S2 slower yellow rank2/award L[1] (distinct, not split)', [rankFor(r, t[1].id), awardFor(r, t[1].id)], [2, L[1]]);
	assert('S2 green rank3/award L[2]', [rankFor(r, t[2].id), awardFor(r, t[2].id)], [3, L[2]]);
}

async function s3AverageSplit(db: SupabaseClient, t: Team[], L: number[]) {
	await resetBattle(db, t);
	// blue & yellow identical raw 15 AND identical elapsed 30 → share avg round((L[0]+L[1])/2).
	const split = Math.round((L[0] + L[1]) / 2);
	await seedSubmission(db, t[0].id, { raw: 15, full: 30, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { raw: 15, full: 28, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { raw: 10, full: 12, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { raw: 5, full: 6, elapsedSec: 30 });
	await setCrown(db, t[0].id); // blue stays top → no +1

	await callResolve('resolve');
	const r = await battleRanking(db);
	assert('S3 blue split award', awardFor(r, t[0].id), split);
	assert('S3 yellow split award', awardFor(r, t[1].id), split);
	assert('S3 blue+yellow share rank 1', [rankFor(r, t[0].id), rankFor(r, t[1].id)], [1, 1]);
	assert('S3 green rank3/award L[2]', [rankFor(r, t[2].id), awardFor(r, t[2].id)], [3, L[2]]);
}

async function s4NonParticipant(db: SupabaseClient, t: Team[], L: number[]) {
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
	// Oracle: the derived ladder's LAST rank always lands on 0 (deriveLadder's
	// invariant), so a non-participant (always last) is awarded L[L.length-1] === 0.
	const last = L[L.length - 1];
	assert('S4 non-participant red rank4/award = last derived slot (0)', [rankFor(r, t[3].id), awardFor(r, t[3].id)], [4, last]);
	assert('S4 non-participant raw_score 0', r.find((x) => x.team_id === t[3].id)?.raw_score, 0);
	assert('S4 non-participant elapsed null', r.find((x) => x.team_id === t[3].id)?.elapsed_seconds, null);
	assert('S4 non-participant Δ == last derived slot', (await teamScore(db, t[3].id)) - redBefore, last);
}

async function s5Idempotency(db: SupabaseClient, t: Team[], L: number[]) {
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
	// Sanity: the ONE award happened (blue got its +L[0] on the first call).
	assert('S5 blue = full 40 + L[0] (added exactly once)', after1[0], 40 + L[0]);
}

async function s6CrownChange(db: SupabaseClient, t: Team[], L: number[]) {
	await resetBattle(db, t);
	// Pre-battle crown holder = yellow (t[1]). After ladder adds blue overtakes by 1.
	//   blue:   full 30 + L[0]
	//   yellow: full 32 + L[1]   (was crown holder)
	//   green:  full 10 + L[2]
	//   red:    full 0  + L[3]
	// blue's post-ladder score > holder yellow's → crown → blue, +1 steal. Exactly one log.
	const blueAfter = 30 + L[0];
	const yellowAfter = 32 + L[1];
	await seedSubmission(db, t[0].id, { raw: 20, full: 30, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { raw: 10, full: 32, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { raw: 5, full: 10, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { raw: 0, full: 0, elapsedSec: 30 });
	await setCrown(db, t[1].id); // yellow holds pre-battle

	await callResolve('resolve');
	if (blueAfter > yellowAfter) {
		assert('S6 crown moved to blue', await crownHolder(db), t[0].id);
		assert('S6 blue = full+L[0]+1 steal', await teamScore(db, t[0].id), blueAfter + 1);
		assert('S6 yellow unchanged (no steal)', await teamScore(db, t[1].id), yellowAfter);
		assert('S6 exactly ONE battle crown log', await battleCrownLogCount(db, t.map((x) => x.id)), 1);
	} else {
		// Degenerate case only if a future max_points/team_count choice flips the
		// comparison — kept so the scenario still asserts SOMETHING meaningful.
		assert('S6 crown stays yellow (blue did not overtake)', await crownHolder(db), t[1].id);
	}
}

async function s7AutoHook(db: SupabaseClient, t: Team[], L: number[]) {
	// (a) All four teams finished → maybeResolveBattle must resolve automatically.
	await resetBattle(db, t);
	await seedSubmission(db, t[0].id, { raw: 20, full: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { raw: 15, full: 20, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { raw: 10, full: 12, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { raw: 5, full: 6, elapsedSec: 30 });
	await setCrown(db, t[0].id);
	await callResolve('maybe');
	assert('S7a all-done → auto-resolved (battle_resolved_at set)', (await resolvedAt(db)) != null, true);
	assert('S7a auto-resolve applied ladder (blue 40+L[0])', await teamScore(db, t[0].id), 40 + L[0]);

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

// ─── stuk 3a: the recap resolution barrier ────────────────────────────────────
// The reveal (3b/3c) is a pure display of stored outcomes, which is only true if
// nothing can reach recap unresolved. These three scenarios cover the barrier's
// whole contract: resolve what's playable, skip what isn't, never double-award.

async function s8aBarrierResolvesAbsentee(db: SupabaseClient, t: Team[], L: number[]) {
	await resetBattle(db, t);
	// The exact case the auto-hook refuses (S7b proves it stays unresolved): red
	// never started, so not every set-team has an ended attempt. Pre-3a this set
	// would reach recap with battle_ranking NULL and the battle would vanish from
	// the reveal. The barrier must resolve it anyway.
	await seedSubmission(db, t[0].id, { raw: 20, full: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { raw: 15, full: 20, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { raw: 10, full: 12, elapsedSec: 30 });
	// t[3] (red): absentee — no attempt, no submission
	await setCrown(db, t[0].id); // blue already top → crown no-op, deltas are pure ladder

	// Precondition: the auto-hook genuinely won't touch this.
	await callResolve('maybe');
	assert('S8a precondition: auto-hook leaves it unresolved', await resolvedAt(db), null);

	const before = [await teamScore(db, t[0].id), await teamScore(db, t[3].id)];
	const res = await callRecapBarrier();
	const after = [await teamScore(db, t[0].id), await teamScore(db, t[3].id)];

	assert('S8a barrier reports it resolved', (res.resolved as string[])?.length, 1);
	assert('S8a battle_resolved_at now set', (await resolvedAt(db)) != null, true);
	const r = await battleRanking(db);
	assert('S8a battle_ranking populated (all 4 teams)', r.length, 4);
	assert('S8a blue rank1/award L[0]', [rankFor(r, t[0].id), awardFor(r, t[0].id)], [1, L[0]]);
	assert('S8a ladder awarded to blue', after[0] - before[0], L[0]);
	// Absentee still ranks last at the always-0 final slot — no free points.
	assert('S8a absentee red rank4/award 0', [rankFor(r, t[3].id), awardFor(r, t[3].id)], [4, L[L.length - 1]]);
	assert('S8a absentee red Δ 0', after[1] - before[1], L[L.length - 1]);
	assert('S8a crown recomputed (stays blue)', await crownHolder(db), t[0].id);
}

async function s8bBarrierSkipsZeroSubmissions(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	// Nobody played this battle at all. Resolving would hand the whole ladder to
	// teams that never touched it, so the barrier must skip and leave it NULL —
	// the reveal then excludes it (it reads battles WHERE battle_ranking IS NOT NULL).
	const before = await Promise.all(t.map((x) => teamScore(db, x.id)));
	const res = await callRecapBarrier();
	const after = await Promise.all(t.map((x) => teamScore(db, x.id)));

	assert('S8b barrier skipped it (no submissions)', (res.skippedNoSubmissions as string[])?.length, 1);
	assert('S8b barrier resolved nothing', (res.resolved as string[])?.length, 0);
	assert('S8b battle_resolved_at stays null', await resolvedAt(db), null);
	assert('S8b battle_ranking stays empty → excluded from reveal', (await battleRanking(db)).length, 0);
	assert('S8b no scores moved', after, before);
}

async function s8cBarrierNoDoubleAward(db: SupabaseClient, t: Team[], L: number[]) {
	await resetBattle(db, t);
	// THE concurrency check: a battle the auto-hook already resolved (all four
	// teams finished), then startRecap's barrier runs over it too. resolveBattle
	// CAS-claims battle_resolved_at first, so the barrier's call must lose the
	// claim and change nothing — no second ladder add, no second crown recompute.
	await seedSubmission(db, t[0].id, { raw: 20, full: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { raw: 15, full: 20, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { raw: 10, full: 12, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { raw: 5, full: 6, elapsedSec: 30 });
	await setCrown(db, t[0].id);

	await callResolve('maybe'); // auto-hook resolves it first (all teams done)
	const afterHook = await Promise.all(t.map((x) => teamScore(db, x.id)));
	const resolvedAtHook = await resolvedAt(db);
	const rankingHook = await battleRanking(db);
	assert('S8c precondition: auto-hook resolved it', resolvedAtHook != null, true);

	const res = await callRecapBarrier(); // now the barrier runs over the same battle
	const afterBarrier = await Promise.all(t.map((x) => teamScore(db, x.id)));

	// The barrier's pre-filter (battle_resolved_at IS NULL) means it shouldn't even
	// consider it — belt and braces with the CAS underneath.
	assert('S8c barrier resolved nothing (already resolved)', (res.resolved as string[])?.length, 0);
	assert('S8c scores IDENTICAL — no double ladder add', afterBarrier, afterHook);
	assert('S8c battle_resolved_at unchanged (claimed once)', await resolvedAt(db), resolvedAtHook);
	assert('S8c battle_ranking unchanged', await battleRanking(db), rankingHook);
	assert('S8c blue = 40 + L[0] exactly once', afterBarrier[0], 40 + L[0]);
	assert('S8c exactly ONE battle crown log', await battleCrownLogCount(db, t.map((x) => x.id)), 0);
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

	// The ladder is derived from max_points + the set's REAL team_count — the
	// same call resolveBattle itself makes — so every scenario's oracle stays
	// correct however many teams this set actually has.
	const LADDER = deriveLadder(MAX_POINTS, teams.length);
	console.log(`  derived ladder for team_count=${teams.length}, max_points=${MAX_POINTS}: [${LADDER.join(',')}]\n`);

	// Snapshot ch20's points_config — RESTORED in finally (fixture hygiene).
	const { data: chBefore } = await db
		.from('challenges')
		.select('points_config')
		.eq('id', BATTLE_CH)
		.maybeSingle();
	const originalConfig = chBefore?.points_config ?? null;

	try {
		// Make ch20 a battle challenge for the run. Storage is now { enabled,
		// max_points } — no ladder stored; resolveBattle derives it at resolution.
		await db
			.from('challenges')
			.update({ points_config: { battle: { enabled: true, max_points: MAX_POINTS } } })
			.eq('id', BATTLE_CH);

		await s1CleanAdditive(db, teams, LADDER);
		await s2SpeedTiebreak(db, teams, LADDER);
		await s3AverageSplit(db, teams, LADDER);
		await s4NonParticipant(db, teams, LADDER);
		await s5Idempotency(db, teams, LADDER);
		await s6CrownChange(db, teams, LADDER);
		await s7AutoHook(db, teams, LADDER);
		await s8aBarrierResolvesAbsentee(db, teams, LADDER);
		await s8bBarrierSkipsZeroSubmissions(db, teams);
		await s8cBarrierNoDoubleAward(db, teams, LADDER);
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
