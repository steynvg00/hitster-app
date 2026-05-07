import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async () => {
	const db = createAdminClient();

	const [{ data: sets }, { data: scRows }, { data: nfcRows }, { data: playerRows }] =
		await Promise.all([
			db.from('game_sets').select('*').order('created_at', { ascending: false }),
			db.from('set_challenges').select('set_id'),
			db.from('nfc_tags').select('set_id').eq('purpose', 'randomizer'),
			db.from('players').select('set_id').not('set_id', 'is', null)
		]);

	const challengeCount: Record<string, number> = {};
	const cardCount: Record<string, number> = {};
	const playerCount: Record<string, number> = {};

	for (const r of scRows ?? []) challengeCount[r.set_id] = (challengeCount[r.set_id] ?? 0) + 1;
	for (const r of nfcRows ?? []) {
		if (r.set_id) cardCount[r.set_id] = (cardCount[r.set_id] ?? 0) + 1;
	}
	for (const r of playerRows ?? []) {
		if (r.set_id) playerCount[r.set_id] = (playerCount[r.set_id] ?? 0) + 1;
	}

	return {
		sets: (sets ?? []).map((s) => ({
			...s,
			challenge_count: challengeCount[s.id] ?? 0,
			card_count: cardCount[s.id] ?? 0,
			player_count: playerCount[s.id] ?? 0
		}))
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const db = createAdminClient();
		const formData = await request.formData();
		const name = (formData.get('name') as string | null)?.trim() ?? '';
		const description = (formData.get('description') as string | null)?.trim() || null;
		const team_count = parseInt(formData.get('team_count') as string) || 6;
		const timer_raw = (formData.get('total_timer_minutes') as string | null)?.trim();
		const total_timer_seconds = timer_raw ? (parseInt(timer_raw) || 0) * 60 || null : null;
		const epc_raw = (formData.get('expected_player_count') as string | null)?.trim();
		const expected_player_count = epc_raw ? parseInt(epc_raw) || null : null;

		if (!name) return fail(400, { error: 'Name is required' });
		if (team_count < 2 || team_count > 6) return fail(400, { error: 'Team count must be 2–6' });

		const { data, error } = await db
			.from('game_sets')
			.insert({ name, description, team_count, total_timer_seconds, expected_player_count, status: 'inactive', created_by: locals.user?.id ?? null })
			.select('id')
			.single();

		if (error || !data) return fail(500, { error: 'Could not create set' });

		redirect(303, `/admin/sets/${data.id}`);
	}
};
