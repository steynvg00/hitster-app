import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async () => {
	const db = createAdminClient();

	const [{ data: tags }, { data: sets }, { data: challenges }] = await Promise.all([
		db.from('nfc_tags').select('*').order('created_at', { ascending: false }),
		db.from('game_sets').select('id, name'),
		db.from('challenges').select('id, title')
	]);

	const setMap = new Map((sets ?? []).map((s) => [s.id, s.name]));
	const challengeMap = new Map((challenges ?? []).map((c) => [c.id, c.title]));

	const enriched = (tags ?? []).map((tag) => ({
		...tag,
		set_name: tag.set_id ? (setMap.get(tag.set_id) ?? null) : null,
		challenge_title: tag.challenge_id ? (challengeMap.get(tag.challenge_id) ?? null) : null
	}));

	return { tags: enriched };
};

export const actions: Actions = {
	delete: async ({ request }) => {
		const db = createAdminClient();
		const formData = await request.formData();
		const id = formData.get('id') as string | null;
		if (!id) return fail(400, { error: 'Missing tag id' });

		const { error } = await db.from('nfc_tags').delete().eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: true };
	}
};
