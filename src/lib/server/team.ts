import { createHmac } from 'crypto';
import { COOKIE_SECRET } from '$env/static/private';
import type { Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'hitster_team';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/**
 * Uitgiftetijd in de ondertekende waarde: `{id}.{uitgiftetijdMs}.{mac}`.
 *
 * Zonder die tijd kan de server een cookie niet uit elkaar houden van vóór en
 * ná een reset — beide dragen dezelfde id en dezelfde geldige handtekening.
 * Mét die tijd is de controle één vergelijking tegen game_sets.player_epoch
 * (zie $lib/server/session-epoch.ts), zonder opzoeking per cookie.
 *
 * De tijd zit BINNEN wat ondertekend wordt, niet ernaast: anders zou een
 * speler hem kunnen ophogen en zijn eigen cookie weer geldig maken.
 *
 * Terugval op het oude tweedelige formaat (`{id}.{mac}`): die cookies staan nu
 * op de telefoons en moeten blijven werken tot ze vanzelf verlopen. Ze krijgen
 * uitgiftetijd 0, dus ze overleven alles behalve een reset — en dat is precies
 * het gedrag dat we willen.
 */
export type SignedSession = { id: string; issuedAt: number };

function sign(payload: string): string {
	const mac = createHmac('sha256', COOKIE_SECRET).update(payload).digest('base64url');
	return `${payload}.${mac}`;
}

function unsign(signed: string): SignedSession | null {
	const lastDot = signed.lastIndexOf('.');
	if (lastDot === -1) return null;
	const payload = signed.slice(0, lastDot);
	if (sign(payload) !== signed) return null;

	const sep = payload.lastIndexOf('.');
	if (sep === -1) return { id: payload, issuedAt: 0 };
	const issuedAt = Number(payload.slice(sep + 1));
	if (!Number.isFinite(issuedAt)) return { id: payload, issuedAt: 0 };
	return { id: payload.slice(0, sep), issuedAt };
}

/** De ruwe sessie, inclusief uitgiftetijd — voor de epoch-controle in hooks. */
export function readTeamSession(cookies: Cookies): SignedSession | null {
	const raw = cookies.get(COOKIE_NAME);
	if (!raw) return null;
	return unsign(raw);
}

export function getTeamIdFromCookie(cookies: Cookies): string | null {
	return readTeamSession(cookies)?.id ?? null;
}

export function setTeamCookie(cookies: Cookies, teamId: string): void {
	cookies.set(COOKIE_NAME, sign(`${teamId}.${Date.now()}`), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: COOKIE_MAX_AGE,
		secure: process.env.NODE_ENV === 'production'
	});
}

export function clearTeamCookie(cookies: Cookies): void {
	cookies.delete(COOKIE_NAME, { path: '/' });
}
