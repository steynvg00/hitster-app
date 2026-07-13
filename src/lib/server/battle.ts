import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { getTeamsInSet } from '$lib/server/randomize';
import { recomputeCrownAfterBattle } from '$lib/server/crown';
import { computeBattleRanking, parseBattleConfig, type BattleEntry } from '$lib/battle-ranking';

type AdminClient = SupabaseClient<Database>;

// Battle Mode (stuk 1/3) — the additive ladder-bonus resolution engine. The pure
// ranking math + config parser live in $lib/battle-ranking (client-safe, no
// server imports) so the harness can exercise them standalone; this module is
// the DB glue: read the ranking inputs, apply the ladder bonus, recompute crown.
//
// A battle challenge is played EXACTLY like a normal one: full scoring, crown,
// streak, powerups, and earning all fire at submit and the full challenge score
// lands in teams.score there (see scoreAndPersistSubmission — nothing deferred).
// Battle ADDS, once all teams have finished the challenge, a rank-based ladder
// bonus on top: teams are ranked by base+bonus (submissions.battle_raw_score,
// written at submit), and each gets ladder[rank] added to teams.score.

/**
 * Resolve a battle challenge for one set: rank all set-teams by base+bonus, add
 * the ladder bonus to teams.score, record the ranking, then recompute the crown.
 *
 * Idempotent via a CAS claim on set_challenges.battle_resolved_at (claimed FIRST,
 * WHERE battle_resolved_at IS NULL) — same pattern as tryConsumeShield. Concurrent
 * last-team submits race to claim; only the winner awards, so the ladder bonus is
 * never double-added. Returns { resolved: false } when the claim was lost (already
 * resolved) or the (set, challenge) pair doesn't exist.
 */
export async function resolveBattle(
	admin: AdminClient,
	setId: string,
	challengeId: string
): Promise<{ resolved: boolean }> {
	// 1. CAS claim — the idempotency guard. Only one caller wins.
	const { data: claimed } = await admin
		.from('set_challenges')
		.update({ battle_resolved_at: new Date().toISOString() } as never)
		.eq('set_id', setId)
		.eq('challenge_id', challengeId)
		.is('battle_resolved_at', null)
		.select('id');
	if (!claimed || claimed.length === 0) return { resolved: false };

	// 2. Ladder from the challenge config.
	const { data: ch } = await admin
		.from('challenges')
		.select('points_config')
		.eq('id', challengeId)
		.maybeSingle();
	const { ladder } = parseBattleConfig(ch?.points_config);

	// 3. Teams in the set (TEAM_COLOR_ORDER-ordered — the crown tiebreak relies on it).
	const teams = await getTeamsInSet(admin, setId);
	const teamIds = teams.map((t) => t.id);
	if (teamIds.length === 0) return { resolved: true };

	// 4. Ranking inputs: raw (base+bonus) from the submission, elapsed from the attempt.
	const [subsRes, attemptsRes] = await Promise.all([
		admin
			.from('submissions')
			.select('team_id, battle_raw_score')
			.eq('challenge_id', challengeId)
			.in('team_id', teamIds),
		admin
			.from('challenge_attempts')
			.select('team_id, started_at, ended_at')
			.eq('challenge_id', challengeId)
			.in('team_id', teamIds)
	]);
	const rawByTeam = new Map((subsRes.data ?? []).map((s) => [s.team_id, s.battle_raw_score ?? 0]));
	const elapsedByTeam = new Map<string, number>();
	for (const a of attemptsRes.data ?? []) {
		if (a.ended_at && a.started_at) {
			elapsedByTeam.set(
				a.team_id,
				(new Date(a.ended_at).getTime() - new Date(a.started_at).getTime()) / 1000
			);
		}
	}
	const entries: BattleEntry[] = teamIds.map((id) => ({
		teamId: id,
		raw: rawByTeam.get(id) ?? 0,
		elapsed: elapsedByTeam.has(id) ? (elapsedByTeam.get(id) as number) : Infinity
	}));

	// 5. Rank + award.
	const ranking = computeBattleRanking(entries, ladder);

	// 6. Apply the ladder bonus (read-then-write, matching the rest of the score
	// pipeline — resolution runs when all attempts for this challenge are done, a
	// quiet moment, so a concurrent score write is unlikely). Log per team.
	const { data: curTeams } = await admin.from('teams').select('id, score').in('id', teamIds);
	const scoreById = new Map((curTeams ?? []).map((t) => [t.id, t.score]));
	for (const r of ranking) {
		if (r.awarded <= 0) continue;
		await admin
			.from('teams')
			.update({ score: (scoreById.get(r.team_id) ?? 0) + r.awarded })
			.eq('id', r.team_id);
		await admin.from('activity_log').insert({
			team_id: r.team_id,
			event_type: 'battle_award',
			payload: { challenge_id: challengeId, rank: r.rank, awarded: r.awarded }
		} as never);
	}

	// 7. Record the ranking outcome.
	await admin
		.from('set_challenges')
		.update({ battle_ranking: ranking as never } as never)
		.eq('set_id', setId)
		.eq('challenge_id', challengeId);

	// 8. Crown recompute AFTER all ladder adds (batch-safe; +1 steal to the new leader).
	await recomputeCrownAfterBattle(admin, setId, teamIds);

	return { resolved: true };
}

/**
 * Auto-resolution hook, called at the end of scoreAndPersistSubmission for a
 * battle challenge once the submitting team's attempt has been ended. Resolves
 * only when EVERY set-team has an ended attempt on this challenge — the natural
 * "all teams finished" signal. Because the auto-submit backstop also ends
 * attempts (on timer expiry), this self-resolves when the last team's timer
 * runs out. A team that never started an attempt blocks this path on purpose;
 * the host "Resolve now" fallback (stuk 2) covers absentees.
 */
export async function maybeResolveBattle(
	admin: AdminClient,
	setId: string,
	challengeId: string
): Promise<void> {
	const teams = await getTeamsInSet(admin, setId);
	const teamIds = teams.map((t) => t.id);
	if (teamIds.length === 0) return;

	const { data: attempts } = await admin
		.from('challenge_attempts')
		.select('team_id, ended_at')
		.eq('challenge_id', challengeId)
		.in('team_id', teamIds);

	const endedTeamIds = new Set(
		(attempts ?? []).filter((a) => a.ended_at != null).map((a) => a.team_id)
	);
	// Every set-team must have an ENDED attempt (started + finished/auto-closed).
	const allDone = teamIds.every((id) => endedTeamIds.has(id));
	if (!allDone) return;

	await resolveBattle(admin, setId, challengeId);
}
