import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';
import { clearCrownAndPowerups, resetGameState } from '$lib/server/reset';

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

	// Per-set scores + fastest-answer data — load in parallel
	const teamSetScores = new Map<string, number>();
	type FastestAnswer = {
		challenge_id: string;
		challenge_name: string;
		team_id: string;
		team_color: string;
		team_display_name: string;
		elapsed_seconds: number;
	};
	const fastestAnswers: FastestAnswer[] = [];

	if (challengeIds.length > 0) {
		const [{ data: subs }, { data: challenges }, { data: attempts }] = await Promise.all([
			db
				.from('submissions')
				.select('team_id, score, challenge_id, created_at')
				.in('challenge_id', challengeIds)
				.eq('is_final', true),
			db.from('challenges').select('id, title').in('id', challengeIds),
			db
				.from('challenge_attempts')
				.select('challenge_id, team_id, started_at')
				.in('challenge_id', challengeIds)
		]);

		for (const sub of subs ?? []) {
			if (sub.team_id) {
				teamSetScores.set(sub.team_id, (teamSetScores.get(sub.team_id) ?? 0) + (sub.score ?? 0));
			}
		}

		// Compute fastest correct submission per challenge
		const teamMap = new Map((teams ?? []).map((t) => [t.id, t]));
		const attemptMap = new Map((attempts ?? []).map((a) => [`${a.challenge_id}:${a.team_id}`, a]));

		for (const ch of challenges ?? []) {
			const correctSubs = (subs ?? []).filter(
				(s) => s.challenge_id === ch.id && (s.score ?? 0) > 0 && s.team_id
			);

			let fastest: FastestAnswer | null = null;
			for (const sub of correctSubs) {
				const attempt = attemptMap.get(`${ch.id}:${sub.team_id}`);
				if (!attempt) continue;
				const elapsed =
					(new Date(sub.created_at).getTime() - new Date(attempt.started_at).getTime()) / 1000;
				const team = teamMap.get(sub.team_id!);
				if (!team) continue;
				if (!fastest || elapsed < fastest.elapsed_seconds) {
					fastest = {
						challenge_id: ch.id,
						challenge_name: ch.title,
						team_id: team.id,
						team_color: team.color,
						team_display_name: team.display_name,
						elapsed_seconds: Math.max(0, elapsed)
					};
				}
			}

			if (fastest) fastestAnswers.push(fastest);
		}

		// Sort by elapsed ascending for display
		fastestAnswers.sort((a, b) => a.elapsed_seconds - b.elapsed_seconds);
	}

	// Rank teams by per-set score (ascending = last place first for bottom-up reveal)
	const rankedTeams = (teams ?? [])
		.map((t) => ({ ...t, setScore: teamSetScores.get(t.id) ?? 0 }))
		.sort((a, b) => a.setScore - b.setScore);

	// Group players by team
	const playersByTeam: Record<
		string,
		{ id: string; display_name: string; photo_url: string | null }[]
	> = {};
	for (const t of rankedTeams) playersByTeam[t.id] = [];
	for (const p of players ?? []) {
		if (p.team_id && playersByTeam[p.team_id]) {
			playersByTeam[p.team_id]!.push(p);
		}
	}

	return {
		gameSet,
		rankedTeams, // index 0 = last place, index N-1 = first place
		playersByTeam,
		fastestAnswers
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
						teamSetScores.set(
							sub.team_id,
							(teamSetScores.get(sub.team_id) ?? 0) + (sub.score ?? 0)
						);
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

		await db
			.from('game_sets')
			.update({
				recap_ranking: ranking as never,
				recap_reveal_index: newIndex,
				recap_state: 'revealing'
			})
			.eq('id', params.id);

		return { success: true, revealedIndex: newIndex - 1 };
	},

	// End the set: set inactive, clear all game state so dashboard returns to "No game running"
	endAndReset: async ({ params }) => {
		const db = createAdminClient();
		const setId = params.id;

		// Crown/powerup hygiene via the shared helper — a finished set must not
		// leak crown or powerup state into its next activation. Scores and
		// submissions are deliberately preserved (the thanks page reads them).
		const { data: gs } = await db
			.from('game_sets')
			.select('team_count')
			.eq('id', setId)
			.maybeSingle();
		const scopedColors = TEAM_COLOR_ORDER.slice(0, gs?.team_count ?? 6);
		const { data: teams } = await db.from('teams').select('id').in('color', scopedColors);
		const errors = await clearCrownAndPowerups(
			db,
			setId,
			(teams ?? []).map((t) => t.id),
			'endAndReset'
		);
		if (errors.length > 0) return fail(500, { error: `End & reset failed: ${errors.join('; ')}` });

		await Promise.all([
			db.from('players').update({ set_id: null, team_id: null }).eq('set_id', setId),
			db
				.from('game_sets')
				.update({
					status: 'inactive',
					play_state: 'joining',
					started_at: null,
					ended_at: null,
					// 'pending' / [] — NULL here violates the CHECK constraints
					// (see CLAUDE.md reset-SQL note); the old null values were a bug.
					recap_state: 'pending',
					recap_ranking: [] as never,
					recap_reveal_index: 0,
					assignment_slots: [] as never,
					assignment_index: 0
				})
				.eq('id', setId)
		]);

		redirect(303, `/admin/sets/${setId}`);
	},

	// Soft reset: clear game data, keep config, return to joining state, snapshot last_results
	resetGame: async ({ params }) => {
		const db = createAdminClient();
		// Same shared helper as the set-console reset — one implementation, no drift.
		const { notFound, errors } = await resetGameState(db, params.id, 'recap');
		if (notFound) return fail(404, { error: 'Set not found' });
		if (errors.length > 0) return fail(500, { error: `Reset failed: ${errors.join('; ')}` });
		redirect(303, `/admin/sets/${params.id}`);
	}
};
