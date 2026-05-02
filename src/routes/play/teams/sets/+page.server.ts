import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { getPlayerIdFromCookie } from '$lib/server/player';
import { setTeamCookie } from '$lib/server/team';
import { assignTeam } from '$lib/server/randomize';

export const load: PageServerLoad = async ({ cookies }) => {
	const playerId = getPlayerIdFromCookie(cookies);
	if (!playerId) redirect(302, '/play/teams');

	const db = createAdminClient();

	const { data: player } = await db
		.from('players')
		.select('id, display_name, photo_url')
		.eq('id', playerId)
		.maybeSingle();

	if (!player) redirect(302, '/play/teams');

	const { data: sets } = await db
		.from('game_sets')
		.select('id, name, description, team_count, status')
		.eq('status', 'active')
		.order('created_at', { ascending: false });

	// Enrich each set with current player count
	const setIds = (sets ?? []).map((s) => s.id);
	let playerCounts: Record<string, number> = {};

	if (setIds.length > 0) {
		const { data: counts } = await db
			.from('players')
			.select('set_id')
			.in('set_id', setIds)
			.not('set_id', 'is', null);

		for (const row of counts ?? []) {
			if (row.set_id) playerCounts[row.set_id] = (playerCounts[row.set_id] ?? 0) + 1;
		}
	}

	return {
		player,
		sets: (sets ?? []).map((s) => ({ ...s, player_count: playerCounts[s.id] ?? 0 }))
	};
};

export const actions: Actions = {
	join: async ({ request, cookies }) => {
		const playerId = getPlayerIdFromCookie(cookies);
		if (!playerId) return fail(401, { error: 'No player session' });

		const formData = await request.formData();
		const set_id = formData.get('set_id') as string | null;
		if (!set_id) return fail(400, { error: 'Missing set' });

		const db = createAdminClient();

		const { data: gameSet } = await db
			.from('game_sets')
			.select('*')
			.eq('id', set_id)
			.maybeSingle();

		if (!gameSet || gameSet.status !== 'active') {
			return fail(400, { error: 'Set is not active' });
		}

		const { team_id, team_color } = await assignTeam(db, set_id, gameSet.team_count);

		await db.from('players').update({ set_id, team_id }).eq('id', playerId);

		setTeamCookie(cookies, team_id);
		redirect(303, `/play/teams/randomizing?team=${team_color}`);
	}
};
