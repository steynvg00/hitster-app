import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { bootstrapSuperAdmins, isWhitelisted } from '$lib/server/whitelist';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	// These pages handle their own auth display — skip the guard to avoid redirect loops
	if (url.pathname === '/admin/login' || url.pathname.startsWith('/admin/access-denied')) {
		return {};
	}

	if (!locals.user) {
		redirect(302, '/admin/login');
	}

	await bootstrapSuperAdmins();

	const { allowed, isSuperAdmin } = await isWhitelisted(locals.user.email!);
	if (!allowed) {
		redirect(303, '/admin/access-denied');
	}

	return {
		user: locals.user,
		isSuperAdmin,
	};
};
