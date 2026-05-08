import type { PageServerLoad } from './$types';
import { createPublicClient } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ cookies }) => {
	const supabase = createPublicClient(cookies);

	const { data: teams } = await supabase
		.from('teams')
		.select('id, color, display_name, score, current_streak, photo_url')
		.order('score', { ascending: false });

	return { teams: teams ?? [] };
};
