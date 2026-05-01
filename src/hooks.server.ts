import type { Handle } from '@sveltejs/kit';
import { getTeamIdFromCookie } from '$lib/server/team';
import { isAdminCookieValid } from '$lib/server/admin';
import { getPlayerIdFromCookie } from '$lib/server/player';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.teamId = getTeamIdFromCookie(event.cookies);
	event.locals.isAdmin = isAdminCookieValid(event.cookies);
	event.locals.playerId = getPlayerIdFromCookie(event.cookies);
	return resolve(event);
};
