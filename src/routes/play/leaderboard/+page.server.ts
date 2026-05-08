import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (!locals.teamId) redirect(302, '/join');

	const supabase = createPublicClient(cookies);
	const admin = createAdminClient();

	const { data: teams } = await supabase
		.from('teams')
		.select('id, color, display_name, score, current_streak, photo_url')
		.order('score', { ascending: false });

	// Determine the player's active set
	let activeSet: { id: string; status: string; recap_state: string | null; scores_hidden: boolean } | null = null;
	if (locals.playerId) {
		const { data: player } = await admin
			.from('players')
			.select('set_id')
			.eq('id', locals.playerId)
			.maybeSingle();
		if (player?.set_id) {
			const { data: gs } = await admin
				.from('game_sets')
				.select('id, status, recap_state, scores_hidden')
				.eq('id', player.set_id)
				.maybeSingle();
			if (gs) activeSet = { ...gs, scores_hidden: (gs as unknown as { scores_hidden?: boolean }).scores_hidden ?? false };
		}
	}

	if (activeSet?.recap_state) {
		redirect(302, `/play/waiting?set_id=${activeSet.id}`);
	}

	return {
		teams: teams ?? [],
		activeSetId: activeSet?.id ?? null,
		scoresHidden: activeSet?.scores_hidden ?? false
	};
};
