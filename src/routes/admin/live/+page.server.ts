import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async () => {
	const db = createAdminClient();

	const [teamsResult, challengesResult, subsResult, activityResult] = await Promise.all([
		db.from('teams').select('*').order('score', { ascending: false }),
		db.from('challenges').select('*').eq('status', 'active'),
		db.from('submissions').select('team_id, challenge_id, score, status').order('submitted_at', { ascending: false }),
		db.from('activity_log').select('*').order('created_at', { ascending: false }).limit(30)
	]);

	const teams = teamsResult.data ?? [];
	const activeChallenges = challengesResult.data ?? [];
	const subs = subsResult.data ?? [];
	const activity = activityResult.data ?? [];

	const activeChallengeIds = activeChallenges.map((c) => c.id);

	// Load all attempts for active challenges
	const attemptsResult = activeChallengeIds.length
		? await db
				.from('challenge_attempts')
				.select('*')
				.in('challenge_id', activeChallengeIds)
		: { data: [] as never[] };
	const attempts = attemptsResult.data ?? [];

	// Which teams submitted to which active challenge
	const activeChallengeIdSet = new Set(activeChallengeIds);
	const activeSubs = subs.filter((s) => activeChallengeIdSet.has(s.challenge_id));

	const submittedMap: Record<string, Set<string>> = {};
	for (const s of activeSubs) {
		if (!submittedMap[s.challenge_id]) submittedMap[s.challenge_id] = new Set();
		submittedMap[s.challenge_id].add(s.team_id);
	}

	// Group attempts by challenge
	const attemptsByChallenge: Record<string, typeof attempts> = {};
	for (const a of attempts) {
		if (!attemptsByChallenge[a.challenge_id]) attemptsByChallenge[a.challenge_id] = [];
		attemptsByChallenge[a.challenge_id].push(a);
	}

	return {
		teams,
		activeChallenges: activeChallenges.map((c) => ({
			...c,
			submittedTeamIds: [...(submittedMap[c.id] ?? [])],
			attempts: attemptsByChallenge[c.id] ?? []
		})),
		recentActivity: activity
	};
};

export const actions: Actions = {
	resetTeamAttempt: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const challengeId = data.get('challenge_id') as string;
		const teamId = data.get('team_id') as string;

		if (!challengeId || !teamId) return fail(400, { error: 'Missing challenge_id or team_id' });

		// Get submission score so we can deduct it from team total
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

	closeChallenge: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing challenge id' });

		const { error } = await db.from('challenges').update({
			status: 'completed',
			is_active: false
		}).eq('id', id);

		if (error) return fail(500, { error: error.message });

		await db.from('activity_log').insert({
			event_type: 'challenge_closed',
			challenge_id: id,
			payload: { closed_by: 'host' }
		});

		return { success: true };
	}
};
