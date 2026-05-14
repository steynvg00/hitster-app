import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';

type PoolName = 'artists' | 'labels' | 'festivals' | 'vocal_sources';
const POOL_TABLES: Record<PoolName, string> = {
	artists: 'answer_pool_artists',
	labels: 'answer_pool_labels',
	festivals: 'answer_pool_festivals',
	vocal_sources: 'answer_pool_vocal_sources'
};

export const load: PageServerLoad = async ({ url }) => {
	const db = createAdminClient();
	const active = (url.searchParams.get('pool') ?? 'artists') as PoolName;
	const table = POOL_TABLES[active] ?? POOL_TABLES.artists;

	const { data: entries, error } = await db
		.from(table as never)
		.select('*')
		.order('name');

	return {
		active,
		entries: (entries as { id: string; name: string; created_at: string }[] | null) ?? [],
		loadError: error?.message ?? null
	};
};

export const actions: Actions = {
	add: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const pool = (data.get('pool') as PoolName) ?? 'artists';
		const name = (data.get('name') as string)?.trim();

		if (!name) return fail(400, { error: 'Name is required' });

		const table = POOL_TABLES[pool];
		if (!table) return fail(400, { error: 'Invalid pool' });

		const { error } = await db.from(table as never).insert({ name } as never);
		if (error) {
			if (error.code === '23505') return fail(409, { error: `"${name}" already exists` });
			return fail(500, { error: error.message });
		}
		return { success: true };
	},

	update: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const pool = data.get('pool') as PoolName;
		const id = data.get('id') as string;
		const name = (data.get('name') as string)?.trim();

		if (!id || !name) return fail(400, { error: 'Missing id or name' });

		const table = POOL_TABLES[pool];
		if (!table) return fail(400, { error: 'Invalid pool' });

		const { error } = await db
			.from(table as never)
			.update({ name } as never)
			.eq('id', id);
		if (error) {
			if (error.code === '23505') return fail(409, { error: `"${name}" already exists` });
			return fail(500, { error: error.message });
		}
		return { success: true };
	},

	delete: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const pool = data.get('pool') as PoolName;
		const id = data.get('id') as string;

		if (!id) return fail(400, { error: 'Missing id' });

		const table = POOL_TABLES[pool];
		if (!table) return fail(400, { error: 'Invalid pool' });

		const { error } = await db
			.from(table as never)
			.delete()
			.eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: true };
	}
};
