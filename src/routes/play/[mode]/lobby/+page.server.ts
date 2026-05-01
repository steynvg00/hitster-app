import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';

const VALID_MODES = ['solo', 'teams'] as const;

export const load: PageServerLoad = async ({ params, locals }) => {
	const mode = params.mode;
	if (!(VALID_MODES as readonly string[]).includes(mode)) redirect(302, '/');

	// No player session — send back to onboarding
	if (!locals.playerId) redirect(302, `/play/${mode}`);

	const db = createAdminClient();
	const { data: player } = await db
		.from('players')
		.select('id, name, display_name, photo_url, mode')
		.eq('id', locals.playerId)
		.maybeSingle();

	// Session row missing (expired + swept, or never written) — re-onboard
	if (!player) redirect(302, `/play/${mode}`);

	return { player, mode };
};
