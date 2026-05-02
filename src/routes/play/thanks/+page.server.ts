import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals, cookies, url }) => {
	if (!locals.teamId) redirect(302, '/join');

	const setId = url.searchParams.get('set_id');
	if (!setId) redirect(302, '/');

	const supabase = createPublicClient(cookies);
	const admin = createAdminClient();

	const [{ data: team }, { data: gameSet }] = await Promise.all([
		supabase.from('teams').select('id, color, display_name').eq('id', locals.teamId).maybeSingle(),
		admin.from('game_sets').select('id, name, status, recap_state').eq('id', setId).maybeSingle()
	]);

	if (!team) redirect(302, '/join');
	if (!gameSet || gameSet.status !== 'completed') redirect(302, '/team');

	// Load challenges in this set with this team's scores
	const { data: setChallenges } = await admin
		.from('set_challenges')
		.select('challenge_id, position')
		.eq('set_id', setId)
		.order('position');

	const challengeIds = (setChallenges ?? []).map((sc) => sc.challenge_id);

	let challengeResults: { title: string; variant: string; score: number | null; maxScore: number }[] = [];

	if (challengeIds.length > 0) {
		const [{ data: challenges }, { data: subs }] = await Promise.all([
			admin.from('challenges').select('id, title, variant').in('id', challengeIds),
			supabase.from('submissions')
				.select('challenge_id, score')
				.in('challenge_id', challengeIds)
				.eq('team_id', locals.teamId)
				.eq('is_final', true)
		]);

		const submissionMap = new Map((subs ?? []).map((s) => [s.challenge_id, s.score]));
		const challengeMap = new Map((challenges ?? []).map((c) => [c.id, c]));

		challengeResults = (setChallenges ?? [])
			.map((sc) => {
				const c = challengeMap.get(sc.challenge_id);
				if (!c) return null;
				return {
					title: c.title,
					variant: c.variant,
					score: submissionMap.get(sc.challenge_id) ?? null,
					maxScore: 0 // Not critical for thanks screen
				};
			})
			.filter((r): r is NonNullable<typeof r> => r != null);
	}

	// Load player info if available
	let playerName: string | null = null;
	if (locals.playerId) {
		const { data: player } = await admin
			.from('players')
			.select('display_name')
			.eq('id', locals.playerId)
			.maybeSingle();
		playerName = player?.display_name ?? null;
	}

	const totalScore = challengeResults.reduce((s, r) => s + (r.score ?? 0), 0);

	return {
		team,
		setName: gameSet.name,
		setId,
		playerName,
		challengeResults,
		totalScore
	};
};
