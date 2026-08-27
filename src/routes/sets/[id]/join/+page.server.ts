import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { setTeamCookie } from '$lib/server/team';
import { resumeSession } from '$lib/server/session';
import { assignTeam, TEAM_COLOR_ORDER } from '$lib/server/randomize';

export const load: PageServerLoad = async ({ params, cookies, locals }) => {
	const { id: set_id } = params;
	const db = createAdminClient();

	const { data: gameSet } = await db
		.from('game_sets')
		.select('id, name, status, play_state, team_count, team_selection_mode, expected_player_count')
		.eq('id', set_id)
		.maybeSingle();

	if (!gameSet || gameSet.status !== 'active') redirect(302, '/nfc/no-game');

	// ── Terugkerende speler EERST, poorten daarna ────────────────────────────
	// Deze URL is het instappunt van de QR-code: het is ook de pagina waar een
	// telefoon op terugkomt als de speler de app verlaat en er later weer in
	// veegt. Stond de play_state-poort hierboven, dan kreeg een speler die AL
	// in deze set zit tijdens `playing` het scherm "Het spel is al bezig" —
	// een doodlopende pagina die alleen naar /leaderboard en / linkt, geen van
	// beide terug naar /team. Voor die speler zag dat eruit alsof hij zijn
	// sessie kwijt was, terwijl zijn cookies gewoon geldig waren.
	//
	// De poort blijft staan voor wie NIET in de set zit — dat is waar hij voor
	// bedoeld is: laat-instappen bestaat niet.
	//
	// locals.playerId in plaats van de cookie rechtstreeks lezen: alleen dat
	// veld is door de sessie-epoch heen gegaan (hooks.server.ts), dus alleen
	// dat veld weet of de host ondertussen heeft gereset.
	const playerId = locals.playerId;

	if (playerId) {
		const { data: player } = await db
			.from('players')
			.select('id, set_id, team_id')
			.eq('id', playerId)
			.maybeSingle();

		// Al toegewezen aan deze set — beide cookies verversen en doorlopen.
		if (player?.set_id === set_id && player?.team_id) {
			await resumeSession(db, cookies, playerId, player.team_id);
			redirect(302, '/team');
		}
	}

	if (gameSet.play_state === 'playing') redirect(302, `/sets/${set_id}/in-progress`);
	if (gameSet.play_state === 'recap') redirect(302, `/sets/${set_id}/over`);

	// Require player session
	if (!playerId) redirect(302, `/play/teams?next=/sets/${set_id}/join`);

	if (gameSet.team_selection_mode === 'random') {
		// assignTeam writes players.set_id/team_id itself (advisory-locked on the
		// fallback path — 0052); no separate update here or the race reopens.
		const { team_id, team_color } = await assignTeam(db, set_id, gameSet.team_count, playerId);
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

	const slotsPerTeam =
		gameSet.expected_player_count && gameSet.expected_player_count > 0
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

	// Overflow: if every team is at capacity, unlock the one with the fewest members
	// so there is always at least one joinable team.
	if (slotsPerTeam !== null && teamList.length > 0 && teamList.every((t) => t.is_full)) {
		const minCount = Math.min(...teamList.map((t) => t.member_count));
		let unlocked = false;
		for (const t of teamList) {
			if (!unlocked && t.member_count === minCount) {
				t.is_full = false;
				unlocked = true;
			}
		}
	}

	return { setName: gameSet.name, teamList, slotsPerTeam };
};

export const actions: Actions = {
	joinTeam: async ({ request, params, cookies, locals }) => {
		const { id: set_id } = params;
		const db = createAdminClient();

		const formData = await request.formData();
		let team_id = (formData.get('team_id') as string | null)?.trim();
		if (!team_id) return fail(400, { error: 'No team selected' });

		const playerId = locals.playerId;
		if (!playerId) redirect(303, `/play/teams?next=/sets/${set_id}/join`);

		const { data: gameSet } = await db
			.from('game_sets')
			.select('id, status, team_count, expected_player_count')
			.eq('id', set_id)
			.maybeSingle();
		if (!gameSet || gameSet.status !== 'active') return fail(400, { error: 'Set not active' });

		// Fullness check only when capacity is configured
		const slotsPerTeam =
			gameSet.expected_player_count && gameSet.expected_player_count > 0
				? Math.ceil(gameSet.expected_player_count / gameSet.team_count)
				: null;

		if (slotsPerTeam !== null) {
			const scopedColors = TEAM_COLOR_ORDER.slice(0, gameSet.team_count);
			const [{ data: allTeams }, { data: members }] = await Promise.all([
				db.from('teams').select('id, color').in('color', scopedColors),
				db.from('players').select('team_id').eq('set_id', set_id).not('team_id', 'is', null)
			]);

			const countMap = new Map<string, number>();
			for (const m of members ?? []) {
				if (m.team_id) countMap.set(m.team_id, (countMap.get(m.team_id) ?? 0) + 1);
			}

			const requestedCount = countMap.get(team_id) ?? 0;
			if (requestedCount >= slotsPerTeam) {
				// Selected team is full — check if every team is full (overflow)
				const allFull = (allTeams ?? []).every((t) => (countMap.get(t.id) ?? 0) >= slotsPerTeam);
				if (!allFull) {
					return fail(400, { error: 'That team is full — please pick another.' });
				}
				// Overflow: silently redirect to the team with fewest members
				const smallest = (allTeams ?? []).reduce((a, b) =>
					(countMap.get(a.id) ?? 0) <= (countMap.get(b.id) ?? 0) ? a : b
				);
				team_id = smallest.id;
			}
		}

		const { data: team } = await db
			.from('teams')
			.select('id, color')
			.eq('id', team_id)
			.maybeSingle();
		if (!team) return fail(400, { error: 'Team not found' });

		await db.from('players').update({ set_id, team_id: team.id }).eq('id', playerId);
		setTeamCookie(cookies, team.id);
		redirect(303, `/play/teams/randomizing?team=${team.color}`);
	}
};
