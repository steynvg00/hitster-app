import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';
import { parseBattleConfig } from '$lib/battle-ranking';
import { resolveBattle } from '$lib/server/battle';

// Battle mode (stuk 2) turnout shape — module-scoped so BOTH the early-return
// (no active sets) and main load() branches agree on the type; otherwise
// TypeScript infers Record<string, BattleStatus> | {} and the {} half has no
// index signature for the .svelte template's data.battleStatus[challenge.id].
type BattleRankEntry = {
	team_id: string;
	rank: number;
	score: number;
};
type BattleStatus = {
	resolved: boolean;
	ranking: BattleRankEntry[] | null;
	outstandingTeamIds: string[];
	hasSubmission: boolean;
};

export const load: PageServerLoad = async ({ url }) => {
	const db = createAdminClient();

	// Find active sets that have at least one player joined
	const { data: activeSets } = await db
		.from('game_sets')
		.select(
			'id, name, team_count, play_state, total_timer_seconds, started_at, scores_hidden, crown_holder_team_id'
		)
		.eq('status', 'active');

	const setsWithPlayers: Array<{
		id: string;
		name: string;
		team_count: number;
		play_state: 'joining' | 'playing' | 'recap';
		total_timer_seconds: number | null;
		started_at: string | null;
		scores_hidden: boolean;
		crown_holder_team_id: string | null;
		player_count: number;
	}> = [];

	await Promise.all(
		(activeSets ?? []).map(async (set) => {
			const { count } = await db
				.from('players')
				.select('*', { count: 'exact', head: true })
				.eq('set_id', set.id);
			if ((count ?? 0) > 0) {
				setsWithPlayers.push({
					...set,
					play_state: (set.play_state ?? 'joining') as 'joining' | 'playing' | 'recap',
					scores_hidden: (set as unknown as { scores_hidden?: boolean }).scores_hidden ?? false,
					crown_holder_team_id:
						(set as unknown as { crown_holder_team_id?: string | null }).crown_holder_team_id ??
						null,
					player_count: count!
				});
			}
		})
	);

	if (setsWithPlayers.length === 0) {
		return {
			activeSets: setsWithPlayers,
			selectedSetId: null,
			selectedSet: null,
			teams: [],
			players: [],
			challenges: [],
			attempts: [],
			submissions: [],
			activity: [],
			teamPowerups: [],
			battleStatus: {} as Record<string, BattleStatus>
		};
	}

	// Determine selected set from URL param (fall back to first)
	const paramSetId = url.searchParams.get('set');
	const validSet = setsWithPlayers.find((s) => s.id === paramSetId);
	const selectedSetId = validSet ? paramSetId! : setsWithPlayers[0].id;
	const selectedSet = validSet ?? setsWithPlayers[0];

	// Load teams scoped to this set's team_count
	const scopedColors = TEAM_COLOR_ORDER.slice(0, selectedSet.team_count);

	const [{ data: teamRows }, { data: playerRows }, { data: setChallengeRows }] = await Promise.all([
		db.from('teams').select('id, color, display_name, score').in('color', scopedColors),
		db.from('players').select('id, display_name, photo_url, team_id').eq('set_id', selectedSetId),
		db
			.from('set_challenges')
			.select('id, challenge_id, position, battle_resolved_at, battle_ranking')
			.eq('set_id', selectedSetId)
			.order('position')
	]);

	const teams = (teamRows ?? []).sort(
		(a, b) =>
			TEAM_COLOR_ORDER.indexOf(a.color as (typeof TEAM_COLOR_ORDER)[number]) -
			TEAM_COLOR_ORDER.indexOf(b.color as (typeof TEAM_COLOR_ORDER)[number])
	);

	const challengeIds = (setChallengeRows ?? []).map((sc) => sc.challenge_id);
	const positionMap = new Map((setChallengeRows ?? []).map((sc) => [sc.challenge_id, sc.position]));

	const [challengeResult, attemptsResult, subsResult, activityResult, teamPowerupsResult] =
		await Promise.all([
			challengeIds.length
				? db
						.from('challenges')
						.select('id, title, variant, timer_seconds, stage_label, status, points_config')
						.in('id', challengeIds)
				: { data: [] as never[] },
			challengeIds.length
				? db.from('challenge_attempts').select('*').in('challenge_id', challengeIds)
				: { data: [] as never[] },
			challengeIds.length
				? db
						.from('submissions')
						.select('team_id, challenge_id, score, status, is_final, answers')
						.in('challenge_id', challengeIds)
				: { data: [] as never[] },
			teams.length
				? db
						.from('activity_log')
						.select('*')
						.in(
							'team_id',
							teams.map((t) => t.id)
						)
						.order('created_at', { ascending: false })
						.limit(30)
				: { data: [] as never[] },
			teams.length
				? db
						.from('team_powerups')
						.select('id, team_id, status, powerup_types(id, name, icon)')
						.in(
							'team_id',
							teams.map((t) => t.id)
						)
						.eq('set_id', selectedSetId)
						// 'active' isn't in this branch's team_powerups status CHECK yet
						// (P3b activation, migration 0047, not merged here) — the hand-
						// maintained database.ts type reflects that. Query forward-
						// compatibly for when it lands; cast past the stale union.
						.in('status', ['held', 'active'] as unknown as ('pending' | 'held' | 'used' | 'lost')[])
				: { data: [] as never[] }
		]);

	// Sort challenges by their position in the set
	const challenges = (challengeResult.data ?? []).sort(
		(a, b) => (positionMap.get(a.id) ?? 0) - (positionMap.get(b.id) ?? 0)
	);

	const teamPowerups = (
		(teamPowerupsResult.data ?? []) as unknown as Array<{
			id: string;
			team_id: string;
			status: 'pending' | 'held' | 'used' | 'lost' | 'active' | 'consumed';
			powerup_types: { id: string; name: string; icon: string | null } | null;
		}>
	).map((row) => ({
		id: row.id,
		team_id: row.team_id,
		status: row.status,
		powerup_types: row.powerup_types
	}));

	// Battle mode (stuk 2): per-battle-challenge turnout, for the "Resolve now"
	// host fallback (absentee teams block the auto-hook in scoreAndPersistSubmission
	// on purpose — this is where the host steps in). Same parseBattleConfig the
	// editor + resolveBattle read, so this can never drift from what's configured.
	const setChallengeByChallenge = new Map(
		(setChallengeRows ?? []).map((sc) => [sc.challenge_id, sc])
	);
	const teamIds = teams.map((t) => t.id);
	const battleStatus: Record<string, BattleStatus> = {};
	for (const ch of challenges) {
		const { enabled } = parseBattleConfig((ch as { points_config?: unknown }).points_config);
		if (!enabled) continue;
		const sc = setChallengeByChallenge.get(ch.id) as
			| { battle_resolved_at?: string | null; battle_ranking?: unknown }
			| undefined;
		const finishedTeamIds = new Set(
			(attemptsResult.data ?? [])
				.filter((a) => a.challenge_id === ch.id && a.ended_at != null)
				.map((a) => a.team_id)
		);
		battleStatus[ch.id] = {
			resolved: sc?.battle_resolved_at != null,
			ranking: (sc?.battle_ranking as BattleRankEntry[] | null) ?? null,
			outstandingTeamIds: teamIds.filter((id) => !finishedTeamIds.has(id)),
			hasSubmission: (subsResult.data ?? []).some((s) => s.challenge_id === ch.id)
		};
	}

	return {
		activeSets: setsWithPlayers,
		selectedSetId,
		selectedSet,
		teams,
		players: playerRows ?? [],
		challenges,
		attempts: attemptsResult.data ?? [],
		submissions: subsResult.data ?? [],
		activity: activityResult.data ?? [],
		teamPowerups,
		battleStatus
	};
};

export const actions: Actions = {
	toggleScoresHidden: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const setId = data.get('set_id') as string;
		if (!setId) return fail(400, { error: 'Missing set_id' });

		const { data: gs } = await db
			.from('game_sets')
			.select('scores_hidden')
			.eq('id', setId)
			.maybeSingle();
		if (!gs) return fail(404, { error: 'Set not found' });

		await db
			.from('game_sets')
			.update({ scores_hidden: !(gs as unknown as { scores_hidden?: boolean }).scores_hidden })
			.eq('id', setId);
		return { success: true };
	},

	resetTeamAttempt: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const challengeId = data.get('challenge_id') as string;
		const teamId = data.get('team_id') as string;

		if (!challengeId || !teamId) return fail(400, { error: 'Missing challenge_id or team_id' });

		const { data: sub } = await db
			.from('submissions')
			.select('score')
			.eq('challenge_id', challengeId)
			.eq('team_id', teamId)
			.maybeSingle();

		if (sub?.score) {
			const { data: team } = await db.from('teams').select('score').eq('id', teamId).single();
			await db
				.from('teams')
				.update({ score: Math.max(0, (team?.score ?? 0) - sub.score) })
				.eq('id', teamId);
		}

		await Promise.all([
			db.from('submissions').delete().eq('challenge_id', challengeId).eq('team_id', teamId),
			db.from('challenge_attempts').delete().eq('challenge_id', challengeId).eq('team_id', teamId)
		]);

		await db.from('activity_log').insert({
			event_type: 'attempt_reset',
			team_id: teamId,
			challenge_id: challengeId,
			payload: { score_deducted: sub?.score ?? 0, reset_by: 'host' }
		});

		return { success: true };
	},

	// Battle mode (stuk 2): the host's absentee fallback. The auto-hook in
	// scoreAndPersistSubmission only resolves once EVERY set-team has an ended
	// attempt — a team that never scanned the challenge blocks it on purpose. This
	// is the real, host-auth-gated production action (this route is under the
	// /admin layout guard) calling the SAME resolveBattle the auto-hook and the
	// dev-only /api/dev/battle-resolve harness endpoint both use — one engine,
	// three callers.
	resolveBattleNow: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const setId = data.get('set_id') as string | null;
		const challengeId = data.get('challenge_id') as string | null;
		if (!setId || !challengeId) return fail(400, { error: 'Missing set_id or challenge_id' });

		const { data: ch } = await db
			.from('challenges')
			.select('points_config')
			.eq('id', challengeId)
			.maybeSingle();
		const { enabled } = parseBattleConfig(ch?.points_config);
		if (!enabled) return fail(400, { error: 'Not a battle challenge' });

		const { data: sc } = await db
			.from('set_challenges')
			.select('battle_resolved_at')
			.eq('set_id', setId)
			.eq('challenge_id', challengeId)
			.maybeSingle();
		if ((sc as { battle_resolved_at?: string | null } | null)?.battle_resolved_at) {
			return fail(400, { error: 'Already resolved' });
		}

		const { count } = await db
			.from('submissions')
			.select('*', { count: 'exact', head: true })
			.eq('challenge_id', challengeId);
		if (!count) return fail(400, { error: 'No submissions yet — nothing to resolve' });

		const result = await resolveBattle(db, setId, challengeId);
		if (!result.resolved) return fail(409, { error: 'Resolution was already claimed' });
		return { success: true, action: 'resolveBattleNow' };
	}
};
