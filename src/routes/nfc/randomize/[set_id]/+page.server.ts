import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { getPlayerIdFromCookie } from '$lib/server/player';
import { setTeamCookie } from '$lib/server/team';
import { assignTeam } from '$lib/server/randomize';

export const load: PageServerLoad = async ({ params, cookies }) => {
	const { set_id } = params;

	const playerId = getPlayerIdFromCookie(cookies);
	if (!playerId) {
		redirect(302, `/play/teams?next=/nfc/randomize/${set_id}`);
	}

	const db = createAdminClient();

	const [{ data: gameSet }, { data: player }] = await Promise.all([
		db.from('game_sets').select('*').eq('id', set_id).maybeSingle(),
		db.from('players').select('id, set_id, team_id').eq('id', playerId).maybeSingle()
	]);

	if (!gameSet) redirect(302, '/');

	// Set is not active — render the "no game running" page
	if (gameSet.status !== 'active') {
		return { inactive: true as const, status: gameSet.status, setName: gameSet.name };
	}

	// Already in this set — restore team cookie and continue
	if (player?.set_id === set_id && player?.team_id) {
		setTeamCookie(cookies, player.team_id);
		redirect(302, '/team');
	}

	const { team_id, team_color } = await assignTeam(db, set_id, gameSet.team_count);

	await db.from('players').update({ set_id, team_id }).eq('id', playerId);

	setTeamCookie(cookies, team_id);
	redirect(302, `/play/teams/randomizing?team=${team_color}`);
};
