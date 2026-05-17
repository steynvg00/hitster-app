import type { PageServerLoad } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ cookies }) => {
	const supabase = createPublicClient(cookies);
	const admin = createAdminClient();

	const [{ data: teams }, { data: activeSet }] = await Promise.all([
		supabase
			.from('teams')
			.select('id, color, display_name, score, current_streak, photo_url')
			.order('score', { ascending: false }),
		admin
			.from('game_sets')
			.select('id, crown_holder_team_id')
			.eq('status', 'active')
			.maybeSingle()
	]);

	return {
		teams: teams ?? [],
		activeSetId: activeSet?.id ?? null,
		crownHolderTeamId: activeSet?.crown_holder_team_id ?? null
	};
};
