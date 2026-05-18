import { createAdminClient } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';

export type WhitelistRow = {
	id: string;
	email: string;
	added_by: string | null;
	added_at: string;
	is_super_admin: boolean;
	notes: string | null;
};

/**
 * Idempotent: upserts each SUPER_ADMIN_EMAILS entry into host_whitelist with
 * is_super_admin=true. Safe to call on every admin layout load — it's a no-op
 * when the env var is empty or the emails already exist.
 */
export async function bootstrapSuperAdmins(): Promise<void> {
	const raw = env.SUPER_ADMIN_EMAILS ?? '';
	if (!raw.trim()) return;

	const emails = raw
		.split(',')
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	if (emails.length === 0) return;

	const admin = createAdminClient();
	for (const email of emails) {
		await admin
			.from('host_whitelist')
			.upsert({ email, is_super_admin: true }, { onConflict: 'email' });
	}
}

/**
 * Upserts an email onto the whitelist as super_admin, but only if not already
 * present (ignoreDuplicates: true). Existing rows keep their current state —
 * a dev user manually demoted to regular admin won't be silently re-elevated.
 * Safe to call on every request; no-op after the first successful insert.
 */
export async function ensureWhitelisted(email: string): Promise<void> {
	const admin = createAdminClient();
	await admin.from('host_whitelist').upsert(
		{ email: email.toLowerCase(), is_super_admin: true },
		{ onConflict: 'email', ignoreDuplicates: true }
	);
}

/**
 * Returns whether the given email is on the whitelist. Case-insensitive.
 */
export async function isWhitelisted(
	email: string
): Promise<{ allowed: boolean; isSuperAdmin: boolean }> {
	const admin = createAdminClient();
	const { data } = await admin
		.from('host_whitelist')
		.select('is_super_admin')
		.eq('email', email.toLowerCase())
		.maybeSingle();

	if (!data) return { allowed: false, isSuperAdmin: false };
	return { allowed: true, isSuperAdmin: data.is_super_admin };
}
