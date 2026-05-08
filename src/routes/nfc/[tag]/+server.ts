import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { setTeamCookie, getTeamIdFromCookie } from '$lib/server/team';
import type { Database } from '$lib/types/database';

type TeamColor = Database['public']['Tables']['teams']['Row']['color'];

// Snake order: blue,yellow,green,red,indigo,black,black,indigo,red,green,yellow,blue,blue,...
// Turnaround duplicates the endpoint team, balancing 28 arrivals as 5,5,5,5,4,4 per team.
const TEAM_COLORS: TeamColor[] = ['blue', 'yellow', 'green', 'red', 'indigo', 'black'];

function snakeColorAt(position: number): TeamColor {
	const period = TEAM_COLORS.length * 2 - 2; // 10
	const pos = position % period;
	return pos < TEAM_COLORS.length ? TEAM_COLORS[pos] : TEAM_COLORS[period - pos];
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const { tag } = params;
	const admin = createAdminClient();

	const { data: nfcTag } = await admin.from('nfc_tags').select('*').eq('id', tag).single();

	if (!nfcTag) redirect(302, '/join?error=unknown-tag');

	// ── Team identity ──────────────────────────────────────────────────────────
	if (nfcTag.purpose === 'team_identity') {
		const { data: team } = await admin
			.from('teams')
			.select('id')
			.eq('color', nfcTag.team_color!)
			.single();
		if (team) setTeamCookie(cookies, team.id);
		redirect(302, '/team');
	}

	// ── Randomizer entry ───────────────────────────────────────────────────────
	if (nfcTag.purpose === 'team_entry') {
		const { count } = await admin
			.from('activity_log')
			.select('*', { count: 'exact', head: true })
			.eq('event_type', 'team_entry');

		const position = count ?? 0;
		const teamColor = snakeColorAt(position);

		const { data: team } = await admin
			.from('teams')
			.select('id')
			.eq('color', teamColor)
			.single();

		if (team) {
			await admin.from('activity_log').insert({
				event_type: 'team_entry',
				team_id: team.id,
				payload: { position, assigned_color: teamColor }
			});
			setTeamCookie(cookies, team.id);
		}
		redirect(302, '/team');
	}

	// ── Challenge station ──────────────────────────────────────────────────────
	if (nfcTag.purpose === 'challenge') {
		if (!getTeamIdFromCookie(cookies)) {
			redirect(302, `/join?redirect=/challenge/${nfcTag.challenge_id}`);
		}
		redirect(302, `/challenge/${nfcTag.challenge_id}`);
	}

	// ── Set randomizer card ────────────────────────────────────────────────────
	if (nfcTag.purpose === 'randomizer' && nfcTag.set_id) {
		redirect(302, `/nfc/randomize/${nfcTag.set_id}`);
	}

	// ── Hint card ──────────────────────────────────────────────────────────────
	if (nfcTag.purpose === 'hint' && nfcTag.challenge_id) {
		redirect(302, `/nfc/hint/${nfcTag.challenge_id}`);
	}

	redirect(302, '/join');
};
