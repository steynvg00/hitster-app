import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';

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
			teamPowerups: []
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
			.select('id, challenge_id, position')
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
						.select('id, title, variant, timer_seconds, stage_label, status')
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
						.in('team_id', teams.map((t) => t.id))
						.order('created_at', { ascending: false })
						.limit(30)
				: { data: [] as never[] },
			teams.length
				? db
						.from('team_powerups')
						.select('id, team_id, status, powerup_types(id, name, icon)')
						.in('team_id', teams.map((t) => t.id))
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
		teamPowerups
	};
};

export const actions: Actions = {
	toggleScoresHidden: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const setId = data.get('set_id') as string;
		if (!setId) return fail(400, { error: 'Missing set_id' });

		const { data: gs } = await db.from('game_sets').select('scores_hidden').eq('id', setId).maybeSingle();
		if (!gs) return fail(404, { error: 'Set not found' });

		await db.from('game_sets').update({ scores_hidden: !(gs as unknown as { scores_hidden?: boolean }).scores_hidden }).eq('id', setId);
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
	}
};
