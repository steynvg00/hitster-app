import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.isAdmin) error(403, 'Forbidden');

	const body = await request.json() as { ids?: unknown };
	const ids = body?.ids;

	if (!Array.isArray(ids) || ids.length === 0) error(400, 'ids must be a non-empty array');
	if (!ids.every((id) => typeof id === 'string')) error(400, 'All ids must be strings');

	const db = createAdminClient();

	// Fetch storage paths before deleting so we can clean up Storage
	const { data: clips, error: fetchError } = await db
		.from('clips')
		.select('id, storage_object_path')
		.in('id', ids as string[]);

	if (fetchError) error(500, fetchError.message);

	const storagePaths = (clips ?? [])
		.map((c) => c.storage_object_path)
		.filter((p): p is string => typeof p === 'string' && p.length > 0);

	if (storagePaths.length > 0) {
		await db.storage.from('audio').remove(storagePaths);
	}

	const { error: deleteError } = await db.from('clips').delete().in('id', ids as string[]);
	if (deleteError) error(500, deleteError.message);

	return json({ success: true, deleted: ids.length });
};
