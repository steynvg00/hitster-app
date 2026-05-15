import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { getPlayerIdFromCookie } from '$lib/server/player';
import { setTeamCookie } from '$lib/server/team';
import { assignTeam, TEAM_COLOR_ORDER } from '$lib/server/randomize';

export const load: PageServerLoad = async ({ params, cookies }) => {
	const { id: set_id } = params;
	const db = createAdminClient();

	const { data: gameSet } = await db
		.from('game_sets')
		.select('id, name, status, play_state, team_count, team_selection_mode, expected_player_count')
		.eq('id', set_id)
		.maybeSingle();

	if (!gameSet || gameSet.status !== 'active') redirect(302, '/nfc/no-game');

	if (gameSet.play_state === 'playing') redirect(302, `/sets/${set_id}/in-progress`);
	if (gameSet.play_state === 'recap') redirect(302, `/sets/${set_id}/over`);

	// Require player session
	const playerId = getPlayerIdFromCookie(cookies);
	if (!playerId) redirect(302, `/play/teams?next=/sets/${set_id}/join`);

	const { data: player } = await db
		.from('players')
		.select('id, set_id, team_id')
		.eq('id', playerId)
		.maybeSingle();

	// Already assigned to this set — restore cookie and continue
	if (player?.set_id === set_id && player?.team_id) {
		setTeamCookie(cookies, player.team_id);
		redirect(302, '/team');
	}

	if (gameSet.team_selection_mode === 'random') {
		const { team_id, team_color } = await assignTeam(db, set_id, gameSet.team_count);
		await db.from('players').update({ set_id, team_id }).eq('id', playerId);
		setTeamCookie(cookies, team_id);
		redirect(302, `/play/teams/randomizing?team=${team_color}`);
	}

	// Selectable mode — fetch teams with member counts for the picker UI
	const scopedColors = TEAM_COLOR_ORDER.slice(0, gameSet.team_count);
	const [{ data: teams }, { data: members }] = await Promise.all([
		db.from('teams').select('id, color, display_name').in('color', scopedColors),
		db.from('players').select('team_id').eq('set_id', set_id).not('team_id', 'is', null)
	]);

	const countMap = new Map<string, number>();
	for (const m of members ?? []) {
		if (m.team_id) countMap.set(m.team_id, (countMap.get(m.team_id) ?? 0) + 1);
	}

	const slotsPerTeam = gameSet.expected_player_count
		? Math.ceil(gameSet.expected_player_count / gameSet.team_count)
		: null;

	const teamList = (teams ?? [])
		.sort((a, b) => TEAM_COLOR_ORDER.indexOf(a.color) - TEAM_COLOR_ORDER.indexOf(b.color))
		.map((t) => ({
			id: t.id,
			color: t.color,
			display_name: t.display_name,
			member_count: countMap.get(t.id) ?? 0,
			is_full: slotsPerTeam !== null && (countMap.get(t.id) ?? 0) >= slotsPerTeam
		}));

	return { setName: gameSet.name, teamList, slotsPerTeam };
};

export const actions: Actions = {
	joinTeam: async ({ request, params, cookies }) => {
		const { id: set_id } = params;
		const db = createAdminClient();

		const formData = await request.formData();
		const team_id = (formData.get('team_id') as string | null)?.trim();
		if (!team_id) return fail(400, { error: 'No team selected' });

		const playerId = getPlayerIdFromCookie(cookies);
		if (!playerId) redirect(303, `/play/teams?next=/sets/${set_id}/join`);

		const { data: gameSet } = await db
			.from('game_sets')
			.select('id, status')
			.eq('id', set_id)
			.maybeSingle();
		if (!gameSet || gameSet.status !== 'active') return fail(400, { error: 'Set not active' });

		const { data: team } = await db
			.from('teams')
			.select('id, color')
			.eq('id', team_id)
			.maybeSingle();
		if (!team) return fail(400, { error: 'Team not found' });

		await db.from('players').update({ set_id, team_id }).eq('id', playerId);
		setTeamCookie(cookies, team_id);
		redirect(303, `/play/teams/randomizing?team=${team.color}`);
	}
};
