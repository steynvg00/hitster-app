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

	if (!gameSet || gameSet.status !== 'active') redirect(302, '/');

	// If set has moved back to joining, let them join
	if (gameSet.play_state === 'joining') {
		redirect(302, `/sets/${params.set_id}/join`);
	}

	return { setName: gameSet.name };
};
