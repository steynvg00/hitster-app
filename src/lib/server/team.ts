import { createHmac } from 'crypto';
import { COOKIE_SECRET } from '$env/static/private';
import type { Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'hitster_team';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

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

export function getTeamIdFromCookie(cookies: Cookies): string | null {
	const raw = cookies.get(COOKIE_NAME);
	if (!raw) return null;
	return unsign(raw);
}

export function setTeamCookie(cookies: Cookies, teamId: string): void {
	cookies.set(COOKIE_NAME, sign(teamId), {
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
