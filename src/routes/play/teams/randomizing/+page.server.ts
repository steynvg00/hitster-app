import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';
import type { TeamColor } from '$lib/types';

// Puur presentatie: het reveal-scherm zet deze naam op 58px in Barlow
// Condensed. De stagenamen ("Indigo — Rawstyler") passen daar niet en de
// designbron toont alleen de teamnaam.
const TEAM_LABELS: Record<TeamColor, string> = {
	blue: 'Team Blauw',
	yellow: 'Team Geel',
	green: 'Team Groen',
	red: 'Team Rood',
	indigo: 'Team Indigo',
	black: 'Team Zwart'
};

export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.playerId) redirect(302, '/play/teams');

	const teamParam = url.searchParams.get('team') as TeamColor | null;
	if (!teamParam || !TEAM_COLOR_ORDER.includes(teamParam)) redirect(302, '/play/teams/sets');

	return {
		team: teamParam,
		label: TEAM_LABELS[teamParam]
	};
};
