import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { setTeamCookie } from '$lib/server/team';
import { resumeSession } from '$lib/server/session';
import { assignTeam } from '$lib/server/randomize';

export const load: PageServerLoad = async ({ cookies, locals }) => {
	// locals.playerId, niet de cookie rechtstreeks: alleen dat veld is door de
	// sessie-epoch-controle in hooks.server.ts heen.
	const playerId = locals.playerId;
	if (!playerId) redirect(302, '/play/teams');

	const db = createAdminClient();

	const { data: player } = await db
		.from('players')
		.select('id, display_name, photo_url, set_id, team_id')
		.eq('id', playerId)
		.maybeSingle();

	if (!player) redirect(302, '/play/teams');

	// ── Al in een lopende set? Dan hoort deze speler niet in de setkiezer ────
	// Dit is de pagina waar terugnavigeren op uitkomt: /team → (terug) →
	// /play/teams/randomizing → (terug) → /play/teams, en die stuurt een speler
	// mét sessie hierheen door. Zonder deze controle kon hij hier opnieuw een
	// set kiezen, waarna assignTeam hem in een ANDER team zette dan waarin hij
	// al speelde — zijn punten bleven bij het oude team achter. Terugnavigeren
	// mag geen nieuwe toewijzing opleveren; het brengt hem terug bij zijn team.
	if (player.set_id && player.team_id) {
		const { data: currentSet } = await db
			.from('game_sets')
			.select('id, status')
			.eq('id', player.set_id)
			.maybeSingle();
		if (currentSet?.status === 'active') {
			await resumeSession(db, cookies, playerId, player.team_id);
			redirect(302, '/team');
		}
	}

	const { data: sets } = await db
		.from('game_sets')
		.select('id, name, description, team_count, status')
		.eq('status', 'active')
		.order('created_at', { ascending: false });

	// Enrich each set with current player count
	const setIds = (sets ?? []).map((s) => s.id);
	const playerCounts: Record<string, number> = {};

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
		// set_id/team_id zijn hierboven alleen gebruikt voor de doorstuur-controle
		// en gaan niet mee naar de client — de kiezer heeft ze niet nodig.
		player: { id: player.id, display_name: player.display_name, photo_url: player.photo_url },
		sets: (sets ?? []).map((s) => ({ ...s, player_count: playerCounts[s.id] ?? 0 }))
	};
};

export const actions: Actions = {
	join: async ({ request, cookies, locals }) => {
		const playerId = locals.playerId;
		if (!playerId) return fail(401, { error: 'No player session' });

		const formData = await request.formData();
		const set_id = formData.get('set_id') as string | null;
		if (!set_id) return fail(400, { error: 'Missing set' });

		const db = createAdminClient();

		const { data: gameSet } = await db.from('game_sets').select('*').eq('id', set_id).maybeSingle();

		if (!gameSet || gameSet.status !== 'active') {
			return fail(400, { error: 'Set is not active' });
		}

		// assignTeam writes players.set_id/team_id itself (advisory-locked on the
		// fallback path — 0052); no separate update here or the race reopens.
		const { team_id, team_color } = await assignTeam(db, set_id, gameSet.team_count, playerId);

		setTeamCookie(cookies, team_id);
		redirect(303, `/play/teams/randomizing?team=${team_color}`);
	}
};
