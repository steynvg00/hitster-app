import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';

export const load: PageServerLoad = async ({ params }) => {
	const db = createAdminClient();
	const { id } = params;

	const { data: gameSet } = await db.from('game_sets').select('*').eq('id', id).maybeSingle();
	if (!gameSet) redirect(302, '/admin/sets');

	const scopedColors = TEAM_COLOR_ORDER.slice(0, gameSet.team_count);

	const [{ data: teams }, { data: players }] = await Promise.all([
		db.from('teams').select('id, color, display_name').in('color', scopedColors),
		db.from('players').select('id, display_name, photo_url, team_id').eq('set_id', id)
	]);

	// Sort teams by stable color order
	const sortedTeams = (teams ?? []).sort(
		(a, b) => TEAM_COLOR_ORDER.indexOf(a.color) - TEAM_COLOR_ORDER.indexOf(b.color)
	);

	// Group players by team
	const playersByTeam: Record<string, typeof players> = {};
	for (const t of sortedTeams) playersByTeam[t.id] = [];
	for (const p of players ?? []) {
		if (p.team_id && playersByTeam[p.team_id]) {
			playersByTeam[p.team_id]!.push(p);
		}
	}

	return { gameSet, teams: sortedTeams, playersByTeam };
};

export const actions: Actions = {
	activate: async ({ params }) => {
		const db = createAdminClient();
		const { error } = await db
			.from('game_sets')
			.update({ status: 'active', started_at: new Date().toISOString() })
			.eq('id', params.id)
			.eq('status', 'draft');
		if (error) return fail(500, { error: 'Could not activate' });
		return { success: true };
	},

	reset: async ({ params }) => {
		const db = createAdminClient();
		await db.from('players').update({ set_id: null, team_id: null }).eq('set_id', params.id);
		return { success: true };
	},

	movePlayer: async ({ request, params }) => {
		const db = createAdminClient();
		const formData = await request.formData();
		const player_id = formData.get('player_id') as string | null;
		const team_id = formData.get('team_id') as string | null;

		if (!player_id || !team_id) return fail(400, { error: 'Missing params' });

		// Verify player belongs to this set
		const { data: player } = await db
			.from('players')
			.select('set_id')
			.eq('id', player_id)
			.maybeSingle();

		if (player?.set_id !== params.id) return fail(403, { error: 'Player not in this set' });

		await db.from('players').update({ team_id }).eq('id', player_id);
		return { success: true };
	}
};
