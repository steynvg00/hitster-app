import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.teamId) redirect(302, '/join');

	const setId = url.searchParams.get('set_id');
	if (!setId) redirect(302, '/team');

	const db = createAdminClient();
	const { data: gs } = await db
		.from('game_sets')
		.select('id, name, status, recap_state')
		.eq('id', setId)
		.maybeSingle();

	if (!gs) redirect(302, '/team');

	// If set is still active, go back to team page
	if (gs.status !== 'completed') redirect(302, '/team');

	// If recap is complete, go to thanks page
	if (gs.recap_state === 'complete') redirect(302, `/play/thanks?set_id=${setId}`);

	return { setId, setName: gs.name, recapState: gs.recap_state };
};
