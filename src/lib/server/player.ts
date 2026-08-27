import { createHmac } from 'crypto';
import { COOKIE_SECRET } from '$env/static/private';
import type { Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'hitster_player';

/**
 * Levensduur van de spelersessie, in seconden.
 *
 * Was 12 uur, en dat is korter dan een evenement duurt. De teamcookie leeft
 * 7 dagen ($lib/server/team.ts), dus op uur 13 verliep de SPELERcookie terwijl
 * het team gewoon doorspeelde: locals.playerId werd null, en daarmee viel
 * activeSetId weg op /team en /challenge/[id]. Gevolg: de powerup-balk
 * verdween (die hangt aan `data.activeSetId`) en de NFC-lock-controle werd
 * overgeslagen.
 *
 * 48 uur dekt een weekend zonder de sessiehygiëne op te geven — de cookie
 * verloopt nog steeds, en /api/player/sweep ruimt de bijbehorende rijen op.
 *
 * DIT IS DE ENIGE PLEK waar deze duur staat. `players.session_expires_at`
 * wordt hiervan afgeleid (play/[mode]/+page.server.ts), zodat cookie en
 * databaserij niet meer uit elkaar kunnen lopen.
 */
export const PLAYER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 48;

const COOKIE_MAX_AGE = PLAYER_SESSION_MAX_AGE_SECONDS;

function sign(value: string): string {
	const mac = createHmac('sha256', COOKIE_SECRET).update(value).digest('base64url');
	return `${value}.${mac}`;
}

function unsign(signed: string): string | null {
	const lastDot = signed.lastIndexOf('.');
	if (lastDot === -1) return null;
	const value = signed.slice(0, lastDot);
	return sign(value) === signed ? value : null;
}

export function getPlayerIdFromCookie(cookies: Cookies): string | null {
	const raw = cookies.get(COOKIE_NAME);
	if (!raw) return null;
	return unsign(raw);
}

export function setPlayerCookie(cookies: Cookies, playerId: string): void {
	cookies.set(COOKIE_NAME, sign(playerId), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: COOKIE_MAX_AGE,
		secure: process.env.NODE_ENV === 'production'
	});
}

export function clearPlayerCookie(cookies: Cookies): void {
	cookies.delete(COOKIE_NAME, { path: '/' });
}
