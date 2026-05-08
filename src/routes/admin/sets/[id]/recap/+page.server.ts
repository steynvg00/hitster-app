import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';

export const load: PageServerLoad = async ({ params }) => {
	const db = createAdminClient();
	const { id } = params;

	const { data: gameSet } = await db.from('game_sets').select('*').eq('id', id).maybeSingle();
	if (!gameSet) redirect(302, '/admin/sets');
	if (!gameSet.recap_state) redirect(302, `/admin/sets/${id}`);

	const scopedColors = TEAM_COLOR_ORDER.slice(0, gameSet.team_count);

	// Load teams, set challenges, submissions, and players in parallel
	const [{ data: teams }, { data: setChallenges }, { data: players }] = await Promise.all([
		db.from('teams').select('id, color, display_name, score').in('color', scopedColors),
		db.from('set_challenges').select('challenge_id').eq('set_id', id),
		db.from('players').select('id, display_name, photo_url, team_id').eq('set_id', id)
	]);

	const challengeIds = (setChallenges ?? []).map((sc) => sc.challenge_id);

	// Per-set scores: sum of final submissions for this set's challenges
	const teamSetScores = new Map<string, number>();
	if (challengeIds.length > 0) {
		const { data: subs } = await db
			.from('submissions')
			.select('team_id, score')
			.in('challenge_id', challengeIds)
			.eq('is_final', true);

		for (const sub of subs ?? []) {
			if (sub.team_id) {
				teamSetScores.set(sub.team_id, (teamSetScores.get(sub.team_id) ?? 0) + (sub.score ?? 0));
			}
		}
	}

	// Rank teams by per-set score (ascending = last place first for bottom-up reveal)
	const rankedTeams = (teams ?? [])
		.map((t) => ({ ...t, setScore: teamSetScores.get(t.id) ?? 0 }))
		.sort((a, b) => a.setScore - b.setScore);

	// Group players by team
	const playersByTeam: Record<string, { id: string; display_name: string; photo_url: string | null }[]> = {};
	for (const t of rankedTeams) playersByTeam[t.id] = [];
	for (const p of players ?? []) {
		if (p.team_id && playersByTeam[p.team_id]) {
			playersByTeam[p.team_id]!.push(p);
		}
	}

	return {
		gameSet,
		rankedTeams,  // index 0 = last place, index N-1 = first place
		playersByTeam
	};
};

export const actions: Actions = {
	// Reveal the next team (lowest unranked)
	reveal: async ({ params }) => {
		const db = createAdminClient();

		const { data: gameSet } = await db
			.from('game_sets')
			.select('id, status, team_count, recap_ranking, recap_reveal_index, recap_state')
			.eq('id', params.id)
			.maybeSingle();

		if (!gameSet || !gameSet.recap_state) return fail(400, { error: 'Recap not started' });

		const scopedColors = TEAM_COLOR_ORDER.slice(0, gameSet.team_count);

		// If ranking not yet set, compute and save it now
		let ranking = (gameSet.recap_ranking ?? []) as string[];
		if (ranking.length === 0) {
			const [{ data: teams }, { data: setChallenges }] = await Promise.all([
				db.from('teams').select('id, color').in('color', scopedColors),
				db.from('set_challenges').select('challenge_id').eq('set_id', params.id)
			]);

			const challengeIds = (setChallenges ?? []).map((sc) => sc.challenge_id);
			const teamSetScores = new Map<string, number>();
			if (challengeIds.length > 0) {
				const { data: subs } = await db
					.from('submissions')
					.select('team_id, score')
					.in('challenge_id', challengeIds)
					.eq('is_final', true);
				for (const sub of subs ?? []) {
					if (sub.team_id) {
						teamSetScores.set(sub.team_id, (teamSetScores.get(sub.team_id) ?? 0) + (sub.score ?? 0));
					}
				}
			}

			// Sort ascending (last place first)
			ranking = (teams ?? [])
				.sort((a, b) => (teamSetScores.get(a.id) ?? 0) - (teamSetScores.get(b.id) ?? 0))
				.map((t) => t.id);
		}

		const newIndex = (gameSet.recap_reveal_index ?? 0) + 1;
		if (newIndex > ranking.length) return fail(400, { error: 'All teams already revealed' });

		await db.from('game_sets').update({
			recap_ranking: ranking as never,
			recap_reveal_index: newIndex,
			recap_state: 'revealing'
		}).eq('id', params.id);

		return { success: true, revealedIndex: newIndex - 1 };
	},

	// End the set: set inactive, clear all game state so dashboard returns to "No game running"
	endAndReset: async ({ params }) => {
		const db = createAdminClient();

		await Promise.all([
			db.from('players').update({ set_id: null, team_id: null }).eq('set_id', params.id),
			db.from('game_sets').update({
				status: 'inactive',
				play_state: 'joining',
				started_at: null,
				ended_at: null,
				recap_state: null as never,
				recap_ranking: null as never,
				recap_reveal_index: 0,
				assignment_slots: [] as never,
				assignment_index: 0
			}).eq('id', params.id)
		]);

		redirect(303, `/admin/sets/${params.id}`);
	}
};
