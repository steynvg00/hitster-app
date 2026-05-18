import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { isWhitelisted } from '$lib/server/whitelist';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const { isSuperAdmin } = await parent();
	if (!isSuperAdmin) {
		redirect(303, '/admin');
	}

	const admin = createAdminClient();
	const { data: entries } = await admin
		.from('host_whitelist')
		.select('*')
		.order('added_at', { ascending: false });

	return { entries: entries ?? [] };
};

export const actions: Actions = {
	addEmail: async ({ request, locals }) => {
		const { allowed, isSuperAdmin } = await isWhitelisted(locals.user!.email!);
		if (!allowed || !isSuperAdmin) return fail(403, { error: 'Not authorized' });

		const data = await request.formData();
		const email = data.get('email')?.toString().trim().toLowerCase();
		if (!email) return fail(400, { error: 'Email is required' });

		const notes = data.get('notes')?.toString().trim() || null;
		const is_super_admin = data.get('is_super_admin') === 'on';

		const admin = createAdminClient();
		const { error } = await admin.from('host_whitelist').insert({
			email,
			notes,
			is_super_admin,
			added_by: locals.user!.id
		});

		if (error) {
			if (error.code === '23505') return fail(400, { error: `${email} is already on the whitelist` });
			return fail(500, { error: error.message });
		}

		return { success: true };
	},

	removeEmail: async ({ request, locals }) => {
		const { allowed, isSuperAdmin } = await isWhitelisted(locals.user!.email!);
		if (!allowed || !isSuperAdmin) return fail(403, { error: 'Not authorized' });

		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400, { error: 'ID required' });

		const admin = createAdminClient();

		const { data: row } = await admin
			.from('host_whitelist')
			.select('email, is_super_admin')
			.eq('id', id)
			.maybeSingle();
		if (!row) return fail(404, { error: 'Entry not found' });

		if (row.email === locals.user!.email!.toLowerCase()) {
			return fail(400, { error: 'Cannot remove yourself from the whitelist' });
		}

		if (row.is_super_admin) {
			const { count } = await admin
				.from('host_whitelist')
				.select('*', { count: 'exact', head: true })
				.eq('is_super_admin', true);
			if ((count ?? 0) <= 1) {
				return fail(400, { error: 'Cannot remove the last super_admin' });
			}
		}

		await admin.from('host_whitelist').delete().eq('id', id);
		return { success: true };
	},

	toggleSuperAdmin: async ({ request, locals }) => {
		const { allowed, isSuperAdmin } = await isWhitelisted(locals.user!.email!);
		if (!allowed || !isSuperAdmin) return fail(403, { error: 'Not authorized' });

		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400, { error: 'ID required' });

		const admin = createAdminClient();

		const { data: row } = await admin
			.from('host_whitelist')
			.select('email, is_super_admin')
			.eq('id', id)
			.maybeSingle();
		if (!row) return fail(404, { error: 'Entry not found' });

		// Self-demotion is intentionally allowed — the last-super-admin count guard
		// below is the real safety net. If you demote yourself and are no longer
		// super_admin, the layout will redirect you to /admin on the next load.
		if (row.is_super_admin) {
			const { count } = await admin
				.from('host_whitelist')
				.select('*', { count: 'exact', head: true })
				.eq('is_super_admin', true);
			if ((count ?? 0) <= 1) {
				return fail(400, { error: 'Cannot demote the last super_admin' });
			}
		}

		await admin.from('host_whitelist').update({ is_super_admin: !row.is_super_admin }).eq('id', id);
		return { success: true };
	}
};
