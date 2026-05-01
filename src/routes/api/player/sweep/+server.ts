import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.isAdmin) error(403, 'Forbidden');

	const db = createAdminClient();

	const { data: expired } = await db
		.from('players')
		.select('id, session_token, photo_url')
		.lt('session_expires_at', new Date().toISOString())
		.not('session_expires_at', 'is', null);

	if (!expired?.length) return json({ swept: 0 });

	const photoPaths = expired
		.filter((p) => p.session_token && p.photo_url)
		.map((p) => `${p.session_token}.jpg`);

	if (photoPaths.length > 0) {
		await db.storage.from('player_photos').remove(photoPaths);
	}

	await db.from('players').delete().in('id', expired.map((p) => p.id));

	return json({ swept: expired.length });
};
