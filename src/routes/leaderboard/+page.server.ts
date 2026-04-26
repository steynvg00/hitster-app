import type { PageServerLoad } from './$types';
import { createPublicClient } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ cookies }) => {
	const supabase = createPublicClient(cookies);

	const { data: teams } = await supabase
		.from('teams')
		.select('*')
		.order('score', { ascending: false });

	return { teams: teams ?? [] };
};
