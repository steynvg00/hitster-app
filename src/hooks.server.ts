import type { Handle } from '@sveltejs/kit';
import { getTeamIdFromCookie } from '$lib/server/team';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.teamId = getTeamIdFromCookie(event.cookies);
	return resolve(event);
};
