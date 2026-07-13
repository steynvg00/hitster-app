import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { getTeamsWithActiveTimedAttempt } from '$lib/server/powerups';

// Backs the offensive target picker's realtime targetability (stuk 2 follow-up):
// challenge_attempts is a realtime table with no set_id/timer_seconds on the row,
// so the client can't derive "is this team in a live TIMED challenge" from the
// event payload alone. Re-running the batched predicate server-side (admin
// client — challenges' anon SELECT policy is scoped to is_active, unreliable for
// this) on every relevant event is simplest-correct; the picker debounces calls.
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.teamId) error(401, 'No team');

	const teamIds = (url.searchParams.get('team_ids') ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (!teamIds.length) return json({ timedTeamIds: [] });

	const admin = createAdminClient();
	const timedTeamIds = await getTeamsWithActiveTimedAttempt(admin, teamIds);
	return json({ timedTeamIds: [...timedTeamIds] });
};
