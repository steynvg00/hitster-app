import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';

// Consume (acknowledge) a team_effects row from the RECEIVING side. Used by the
// give_a_shot "Drunk!" acknowledgement (stuk 1) and reused by tap_to_break's
// break action (stuk 3). team_effects has no anon UPDATE policy, so the write
// goes through the admin client — authorization is the explicit ownership check:
// the effect's team_id (the affected/target team) must match the caller's team
// cookie. A team can only consume effects aimed at itself.
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.teamId) error(401, 'No team');

	const body = (await request.json().catch(() => null)) as { effect_id?: string } | null;
	const effectId = body?.effect_id?.trim();
	if (!effectId) return json({ error: 'Missing effect_id' }, { status: 400 });

	const admin = createAdminClient();
	const { data: eff } = await admin
		.from('team_effects')
		.select('id, team_id')
		.eq('id', effectId)
		.maybeSingle();

	if (!eff || eff.team_id !== locals.teamId) return json({ error: 'Forbidden' }, { status: 403 });

	await admin
		.from('team_effects')
		.update({ consumed_at: new Date().toISOString() } as never)
		.eq('id', effectId)
		.is('consumed_at', null);

	return json({ ok: true });
};
