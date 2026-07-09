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
// user and couldn't create one" (so we don't re-query auth on every request).
let cachedDevUser: User | null | undefined;

// Dedicated dev-only host account. A fixed, non-real email so it never collides
// with a real Google/magic-link sign-in for the actual admin. It gives
// created_by (FK → auth.users) a valid, stable target for locally-created rows.
const DEV_HOST_EMAIL = 'dev-host@mixup.local';

/**
 * Resolve a real host user to use as the local dev admin identity.
 *
 * Preference: a super-admin whitelisted user → any whitelisted user → a
 * SUPER_ADMIN_EMAILS env user → any existing auth user. If auth.users is empty
 * (nobody has signed in on this Supabase project yet — the common case that made
 * the bypass silently no-op), get-or-create a dedicated dev host user so there's
 * always a valid identity + FK target. Whitelists whoever it picks as
 * super-admin so the admin layout guard passes. Returns null only if creating
 * the dev host fails.
 */
export async function resolveDevUser(): Promise<User | null> {
	if (cachedDevUser !== undefined) return cachedDevUser;

	const admin = createAdminClient();

	const [{ data: whitelist }, { data: list }] = await Promise.all([
		admin.from('host_whitelist').select('email, is_super_admin'),
		admin.auth.admin.listUsers({ perPage: 1000 })
	]);

	const users = list?.users ?? [];
	const emailOf = (u: User) => u.email?.toLowerCase() ?? '';

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

	let pick =
		users.find((u) => superEmails.has(emailOf(u))) ??
		users.find((u) => whitelistedEmails.has(emailOf(u))) ??
		users.find((u) => envEmails.has(emailOf(u))) ??
		users.find((u) => emailOf(u) === DEV_HOST_EMAIL);

	// No usable real user → get-or-create the dedicated dev host.
	if (!pick) {
		console.log(
			`[dev-auth] No usable host in auth.users (${users.length} total) — creating ${DEV_HOST_EMAIL}`
		);
		const { data: created, error } = await admin.auth.admin.createUser({
			email: DEV_HOST_EMAIL,
			email_confirm: true,
			user_metadata: { full_name: 'Dev Host' }
		});
		if (error && !created?.user) {
			// Likely already exists (e.g. paginated past 1000) — re-fetch and find it.
			const { data: relist } = await admin.auth.admin.listUsers({ perPage: 1000 });
			pick = (relist?.users ?? []).find((u) => emailOf(u) === DEV_HOST_EMAIL);
			if (!pick) {
				console.warn(`[dev-auth] Could not create dev host user: ${error.message}`);
				cachedDevUser = null;
				return null;
			}
		} else {
			pick = created?.user ?? undefined;
		}
	}

	if (!pick) {
		cachedDevUser = null;
		return null;
	}

	// Ensure the picked identity is whitelisted as super-admin so the guard passes.
	await admin
		.from('host_whitelist')
		.upsert(
			{ email: (pick.email ?? DEV_HOST_EMAIL).toLowerCase(), is_super_admin: true },
			{ onConflict: 'email', ignoreDuplicates: true }
		);

	console.log(`[dev-auth] Admin login bypassed — acting as ${pick.email ?? pick.id}`);
	cachedDevUser = pick;
	return pick;
}
