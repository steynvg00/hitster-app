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

	// DEV-ONLY: skip host login locally. When there's no real Supabase session,
	// act as a real existing host user so /admin/* is reachable AND created_by
	// (FK → auth.users) writes stay valid. The whitelist guard in
	// admin/+layout.server.ts then passes on its own (it auto-whitelists the
	// signed-in email in dev). Vite replaces import.meta.env.DEV with false in
	// production and tree-shakes this block; the dynamic import keeps dev-auth
	// out of the prod bundle entirely. No production behavior change.
	if (import.meta.env.DEV && !event.locals.user) {
		const { resolveDevUser } = await import('$lib/server/dev-auth');
		const devUser = await resolveDevUser();
		if (devUser) {
			event.locals.user = devUser;
			event.locals.isAdmin = true;
		}
	}

	return resolve(event);
};
