import type { LayoutServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.playerId) return { activeSetId: null };

	const db = createAdminClient();
	const { data: player } = await db
		.from('players')
		.select('set_id')
		.eq('id', locals.playerId)
		.maybeSingle();

	return { activeSetId: player?.set_id ?? null };
};
