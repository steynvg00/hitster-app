import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ params }) => {
	const db = createAdminClient();
	const { data: gameSet } = await db
		.from('game_sets')
		.select('id, name, play_state, status')
		.eq('id', params.set_id)
		.maybeSingle();

	if (!gameSet) redirect(302, '/');

	return { setName: gameSet.name };
};
