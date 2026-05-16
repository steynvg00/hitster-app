import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ request }) => {
	if (!import.meta.env.DEV) return json({ error: 'not dev' }, { status: 403 });

	const { team_color, powerup_type_id, set_id } = await request.json();
	if (!team_color || !powerup_type_id || !set_id)
		return json({ error: 'missing fields' }, { status: 400 });

	const admin = createAdminClient();

	const { data: team } = await admin
		.from('teams')
		.select('id')
		.eq('color', team_color)
		.maybeSingle();
	if (!team) return json({ error: 'team not found' }, { status: 404 });

	const { data, error } = await admin
		.from('team_powerups')
		.insert({ team_id: team.id, set_id, powerup_type_id, status: 'held' })
		.select('id')
		.single();

	if (error) return json({ error: error.message }, { status: 500 });
	return json({ ok: true, id: data.id });
};
