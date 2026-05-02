import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';
import type { TeamColor } from '$lib/types';

const TEAM_LABELS: Record<TeamColor, string> = {
	blue: 'Blue — Raw',
	yellow: 'Yellow — UV',
	green: 'Green — Mainstage',
	red: 'Red — Mainstage',
	indigo: 'Indigo — Rawstyler',
	black: 'Black — Freedom'
};

const TEAM_BG: Record<TeamColor, string> = {
	blue: '#1d4ed8',
	yellow: '#ca8a04',
	green: '#15803d',
	red: '#b91c1c',
	indigo: '#4338ca',
	black: '#27272a'
};

export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.playerId) redirect(302, '/play/teams');

	const teamParam = url.searchParams.get('team') as TeamColor | null;
	if (!teamParam || !TEAM_COLOR_ORDER.includes(teamParam)) redirect(302, '/play/teams/sets');

	return {
		team: teamParam,
		label: TEAM_LABELS[teamParam],
		bg: TEAM_BG[teamParam]
	};
};
