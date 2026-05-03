import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (!locals.teamId) redirect(302, '/join');

	const supabase = createPublicClient(cookies);
	const admin = createAdminClient();

	const { data: teams } = await supabase
		.from('teams')
		.select('*')
		.order('score', { ascending: false });

	// Determine the player's active set (needed to decide whether to show leaderboard)
	let activeSet: { id: string; status: string } | null = null;
	if (locals.playerId) {
		const { data: player } = await admin
			.from('players')
			.select('set_id')
			.eq('id', locals.playerId)
			.maybeSingle();
		if (player?.set_id) {
			const { data: gs } = await admin
				.from('game_sets')
				.select('id, status')
				.eq('id', player.set_id)
				.maybeSingle();
			if (gs) activeSet = gs;
		}
	}

	// If set is completed, send player to the waiting/reveal screen
	if (activeSet?.status === 'completed') {
		redirect(302, `/play/waiting?set_id=${activeSet.id}`);
	}

	return {
		teams: teams ?? [],
		activeSetId: activeSet?.id ?? null
	};
};
