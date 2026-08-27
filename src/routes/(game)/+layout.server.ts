import type { LayoutServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.playerId) return { activeSetId: null, playerEpoch: null };

	const db = createAdminClient();
	const { data: player } = await db
		.from('players')
		.select('set_id')
		.eq('id', locals.playerId)
		.maybeSingle();

	const activeSetId = player?.set_id ?? null;
	if (!activeSetId) return { activeSetId: null, playerEpoch: null };

	// De sessie-epoch van deze set. Verandert die, dan heeft de HOST gereset —
	// zie +layout.svelte voor wat de speler daar van merkt.
	const { data: gs } = await db
		.from('game_sets')
		.select('player_epoch')
		.eq('id', activeSetId)
		.maybeSingle();

	return { activeSetId, playerEpoch: gs?.player_epoch ?? null };
};
