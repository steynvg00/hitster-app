// DEV-ONLY admin-login bypass helper.
//
// Locally we don't want to log in to reach /admin/*. But `created_by` on all
// host-managed tables is FK-constrained to auth.users(id), and many admin
// writes set `created_by: locals.user.id` (some hard-require it) or filter
// ownership with `.eq('created_by', user.id)`. A synthetic uuid would FK-fail
// those inserts and hide the real host's content — so instead we resolve a REAL
// existing host user and act as them.
//
// This module is only ever imported behind an `import.meta.env.DEV` guard (via
// dynamic import in hooks.server.ts), so Vite keeps it out of the prod bundle.

import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';

// Module-level cache. undefined = not resolved yet; null = resolved to "no host
// user exists locally" (so we don't re-query auth on every request).
let cachedDevUser: User | null | undefined;

/**
 * Resolve a real host user to use as the local dev admin identity.
 *
 * Preference order: a super-admin whitelisted user → any whitelisted user →
 * a SUPER_ADMIN_EMAILS env user → the first auth user. Returns null only when
 * the local database has no auth.users at all.
 */
export async function resolveDevUser(): Promise<User | null> {
	if (cachedDevUser !== undefined) return cachedDevUser;

	const admin = createAdminClient();

	const [{ data: whitelist }, { data: list }] = await Promise.all([
		admin.from('host_whitelist').select('email, is_super_admin'),
		admin.auth.admin.listUsers()
	]);

	const users = list?.users ?? [];
	if (users.length === 0) {
		console.warn(
			'[dev-auth] No auth.users found locally — cannot bypass admin login. Sign in once to create a host user.'
		);
		cachedDevUser = null;
		return null;
	}

	const superEmails = new Set(
		(whitelist ?? []).filter((r) => r.is_super_admin).map((r) => r.email.toLowerCase())
	);
	const whitelistedEmails = new Set((whitelist ?? []).map((r) => r.email.toLowerCase()));
	const envEmails = new Set(
		(env.SUPER_ADMIN_EMAILS ?? '')
			.split(',')
			.map((e) => e.trim().toLowerCase())
			.filter(Boolean)
	);

	const emailOf = (u: User) => u.email?.toLowerCase() ?? '';
	const pick =
		users.find((u) => superEmails.has(emailOf(u))) ??
		users.find((u) => whitelistedEmails.has(emailOf(u))) ??
		users.find((u) => envEmails.has(emailOf(u))) ??
		users[0];

	console.log(`[dev-auth] Admin login bypassed — acting as ${pick.email ?? pick.id}`);
	cachedDevUser = pick;
	return pick;
}
