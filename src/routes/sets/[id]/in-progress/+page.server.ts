import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ params }) => {
	const db = createAdminClient();
	const { data: gameSet } = await db
		.from('game_sets')
		.select('id, name, play_state, status')
		.eq('id', params.id)
		.maybeSingle();

	if (!gameSet || gameSet.status !== 'active') redirect(302, '/');

	// If set moved back to joining, let them join via the URL
	if (gameSet.play_state === 'joining') {
		redirect(302, `/sets/${params.id}/join`);
	}

	return { setName: gameSet.name };
};
