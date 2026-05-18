import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { LayoutServerLoad } from './$types';
import { bootstrapSuperAdmins, isWhitelisted, ensureWhitelisted } from '$lib/server/whitelist';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	// These pages handle their own auth display — skip the guard to avoid redirect loops
	if (url.pathname === '/admin/login' || url.pathname.startsWith('/admin/access-denied')) {
		return {};
	}

	if (!locals.user) {
		redirect(302, '/admin/login');
	}

	await bootstrapSuperAdmins();

	// In dev mode, auto-whitelist the signed-in user so the dev login UX is
	// seamless. ignoreDuplicates: true means existing rows keep their state.
	// This block is tree-shaken out of production builds by Vite.
	if (dev && locals.user?.email) {
		await ensureWhitelisted(locals.user.email);
	}

	const { allowed, isSuperAdmin } = await isWhitelisted(locals.user.email!);
	if (!allowed) {
		redirect(303, '/admin/access-denied');
	}

	return {
		user: locals.user,
		isSuperAdmin,
	};
};
