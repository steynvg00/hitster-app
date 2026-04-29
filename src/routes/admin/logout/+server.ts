import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearAdminCookie } from '$lib/server/admin';

export const GET: RequestHandler = ({ cookies }) => {
	clearAdminCookie(cookies);
	redirect(302, '/admin/login');
};
