import type { Handle } from '@sveltejs/kit';
import { getTeamIdFromCookie } from '$lib/server/team';
import { getPlayerIdFromCookie } from '$lib/server/player';
import { createPublicClient } from '$lib/server/supabase';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.teamId = getTeamIdFromCookie(event.cookies);
	event.locals.playerId = getPlayerIdFromCookie(event.cookies);

	// Supabase Auth — getUser() does a server-round-trip to verify the JWT,
	// so the result is trustworthy (unlike getSession() which trusts the cookie as-is).
	const supabase = createPublicClient(event.cookies);
	const {
		data: { user }
	} = await supabase.auth.getUser();
	event.locals.user = user ?? null;
	event.locals.isAdmin = event.locals.user !== null;

	return resolve(event);
};
