import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { getPlayerIdFromCookie } from '$lib/server/player';
import { setTeamCookie } from '$lib/server/team';
import { assignTeam } from '$lib/server/randomize';

export const load: PageServerLoad = async ({ params, cookies }) => {
	const { set_id } = params;

	const db = createAdminClient();

	const { data: gameSet } = await db.from('game_sets').select('*').eq('id', set_id).maybeSingle();

	if (!gameSet || gameSet.status !== 'active') redirect(302, '/nfc/no-game');

	// Game already in progress — send to placeholder page (no auth required)
	if (gameSet.play_state === 'playing') {
		redirect(302, `/nfc/game-in-progress/${set_id}`);
	}

	// Game in recap — send to game-over page (no auth required)
	if (gameSet.play_state === 'recap') {
		redirect(302, `/nfc/game-over/${set_id}`);
	}

	// play_state === 'joining' — player auth required to assign a team
	const playerId = getPlayerIdFromCookie(cookies);
	if (!playerId) {
		redirect(302, `/play/teams?next=/nfc/randomize/${set_id}`);
	}

	const { data: player } = await db
		.from('players')
		.select('id, set_id, team_id')
		.eq('id', playerId)
		.maybeSingle();

	// Already in this set — restore team cookie and continue
	if (player?.set_id === set_id && player?.team_id) {
		setTeamCookie(cookies, player.team_id);
		redirect(302, '/team');
	}

	// assignTeam writes players.set_id/team_id itself (advisory-locked on the
	// fallback path — 0052); no separate update here or the race reopens.
	const { team_id, team_color } = await assignTeam(db, set_id, gameSet.team_count, playerId);

	setTeamCookie(cookies, team_id);
	redirect(302, `/play/teams/randomizing?team=${team_color}`);
};
