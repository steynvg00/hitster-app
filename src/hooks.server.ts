import type { Handle } from '@sveltejs/kit';
import { readTeamSession, clearTeamCookie } from '$lib/server/team';
import { readPlayerSession, clearPlayerCookie } from '$lib/server/player';
import { getSessionEpoch } from '$lib/server/session-epoch';
import { createPublicClient } from '$lib/server/supabase';

export const handle: Handle = async ({ event, resolve }) => {
	const teamSession = readTeamSession(event.cookies);
	const playerSession = readPlayerSession(event.cookies);

	// Sessies van vóór de laatste set-reset laten vervallen.
	//
	// De reset draait op de host-console en komt niet bij de cookies van 28
	// andere telefoons. Die cookies blijven dus staan; ze tellen alleen niet
	// meer. Dit is het moment waarop dat blijkt: het eerstvolgende verzoek van
	// zo'n toestel. De cookie wordt hier ook echt gewist, zodat de browser hem
	// niet elk verzoek opnieuw meestuurt en de speler netjes in de join-flow
	// terechtkomt in plaats van in een halve oude sessie.
	//
	// De opzoeking gebeurt alleen als er überhaupt een cookie is (dus niet voor
	// de host-console, /leaderboard of assets) en is achter een cache van 10 s
	// gezet — zie $lib/server/session-epoch.ts.
	let teamId = teamSession?.id ?? null;
	let playerId = playerSession?.id ?? null;

	if (teamSession || playerSession) {
		const epoch = await getSessionEpoch();
		if (epoch > 0) {
			if (teamSession && teamSession.issuedAt < epoch) {
				clearTeamCookie(event.cookies);
				teamId = null;
			}
			if (playerSession && playerSession.issuedAt < epoch) {
				clearPlayerCookie(event.cookies);
				playerId = null;
			}
		}
	}

	event.locals.teamId = teamId;
	event.locals.playerId = playerId;

	// ── Laagprobe (?probe=laag) ────────────────────────────────────────────
	// Diagnose op het toestel, zie $lib/components/LayerProbe.svelte.
	//
	// Waarom dit hier moet en niet in het component: bijna elk instappunt van
	// de spelersflow is een REDIRECT. /join stuurt door naar /team,
	// /sets/[id]/join naar /play/teams of /play/teams/randomizing. SvelteKit
	// stuurt daarbij een kale Location mee, dus de query-parameter valt weg
	// vóórdat er ook maar één regel clientcode draait — het component kreeg
	// hem nooit te zien. En juist de schermen uit de klacht (de randomizer,
	// de team reveal) zijn alleen via zo'n redirect te bereiken.
	//
	// De parameter zet daarom hier een vlag, op de response die de redirect
	// zelf draagt. Sessiecookie zonder httpOnly: hij verdwijnt als de browser
	// dicht gaat, en het component mag hem lezen. Er zit niets in behalve
	// "aan". `?probe=uit` haalt hem weer weg.
	const probe = event.url.searchParams.get('probe');
	if (probe === 'laag') {
		//
		// Geen `secure`, in tegenstelling tot de sessiecookies hiernaast. Die
		// dragen identiteit; deze draagt het cijfer 1. Met `secure` weigert de
		// browser hem op elke preview die niet over https loopt, en dan is de
		// probe precies daar onbruikbaar waar hij nodig is. Gemeten: over
		// http://localhost:4173 komt hij mét `secure` niet aan en zónder wel.
		event.cookies.set('mixup_probe', '1', {
			path: '/',
			httpOnly: false,
			sameSite: 'lax',
			secure: false
		});
	} else if (probe === 'uit') {
		// Dezelfde attributen als bij het zetten. Met alleen `{ path: '/' }` zet
		// SvelteKit er zijn standaard `HttpOnly` op, en dan haalt WebKit de
		// bestaande niet-HttpOnly cookie er niet mee weg — gemeten: `?probe=uit`
		// leek te werken, maar op de volgende pagina stond de balk er weer.
		event.cookies.delete('mixup_probe', {
			path: '/',
			httpOnly: false,
			sameSite: 'lax',
			secure: false
		});
	}

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
