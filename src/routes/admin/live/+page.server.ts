import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async () => {
	const db = createAdminClient();

	const [teamsResult, challengesResult, subsResult, activityResult] = await Promise.all([
		db.from('teams').select('*').order('score', { ascending: false }),
		db.from('challenges').select('*').eq('status', 'active'),
		db.from('submissions').select('*').order('submitted_at', { ascending: false }),
		db.from('activity_log').select('*').order('created_at', { ascending: false }).limit(30)
	]);

	const teams = teamsResult.data ?? [];
	const activeChallenges = challengesResult.data ?? [];
	const subs = subsResult.data ?? [];
	const activity = activityResult.data ?? [];

	// Which teams submitted to which active challenge
	const activeChallengeIds = new Set(activeChallenges.map((c) => c.id));
	const activeSubs = subs.filter((s) => activeChallengeIds.has(s.challenge_id));

	const submittedMap: Record<string, Set<string>> = {};
	for (const s of activeSubs) {
		if (!submittedMap[s.challenge_id]) submittedMap[s.challenge_id] = new Set();
		submittedMap[s.challenge_id].add(s.team_id);
	}

	return {
		teams,
		activeChallenges: activeChallenges.map((c) => ({
			...c,
			submittedTeamIds: [...(submittedMap[c.id] ?? [])]
		})),
		recentActivity: activity
	};
};

export const actions: Actions = {
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
