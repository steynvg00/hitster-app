import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (!locals.teamId) redirect(302, '/join');

	const supabase = createPublicClient(cookies);
	const admin = createAdminClient();

	const { data: team } = await supabase
		.from('teams')
		.select('*')
		.eq('id', locals.teamId)
		.single();

	if (!team) redirect(302, '/join');

	// Leaderboard position (1-based, sorted by score desc)
	const { data: allTeams } = await supabase
		.from('teams')
		.select('id, score')
		.order('score', { ascending: false });

	const position = ((allTeams ?? []).findIndex((t) => t.id === locals.teamId) + 1) || 1;
	const totalTeams = (allTeams ?? []).length;

	// Active challenges + this team's submission status
	const { data: challenges } = await supabase
		.from('challenges')
		.select('id, title, variant, timer_seconds')
		.eq('is_active', true);

	const { data: submissions } = await supabase
		.from('submissions')
		.select('challenge_id, score')
		.eq('team_id', locals.teamId);

	const submittedMap = new Map((submissions ?? []).map((s) => [s.challenge_id, s.score]));

	const challengeList = (challenges ?? []).map((c) => ({
		...c,
		status: submittedMap.has(c.id) ? ('completed' as const) : ('available' as const),
		earnedScore: submittedMap.get(c.id) ?? null
	}));

	// Recent activity for this team (admin client — activity_log has no public read policy)
	const { data: recentActivity } = await admin
		.from('activity_log')
		.select('id, event_type, payload, created_at')
		.eq('team_id', locals.teamId)
		.order('created_at', { ascending: false })
		.limit(8);

	return {
		team,
		position,
		totalTeams,
		challenges: challengeList,
		recentActivity: recentActivity ?? []
	};
};
