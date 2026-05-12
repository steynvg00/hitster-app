import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import type { NfcTagRow } from '$lib/types/database';

export const load: PageServerLoad = async ({ locals, url }) => {
	const db = createAdminClient();
	const userId = locals.user?.id;

	const slugFilter = url.searchParams.get('slug') ?? null;
	const teamFilter = url.searchParams.get('team') ?? null;
	const purposeFilter = url.searchParams.get('purpose') ?? null;

	let query = db.from('nfc_tags').select('*').order('created_at', { ascending: false });
	if (userId) query = query.eq('created_by', userId);
	if (slugFilter) query = query.eq('slug', slugFilter);
	if (teamFilter)
		query = query.eq('team_color', teamFilter as NonNullable<NfcTagRow['team_color']>);
	if (purposeFilter) query = query.eq('purpose', purposeFilter as NfcTagRow['purpose']);

	const [{ data: tags }, { data: sets }, { data: challenges }] = await Promise.all([
		query,
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

	return { tags: enriched, slugFilter, teamFilter, purposeFilter };
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const db = createAdminClient();
		const formData = await request.formData();
		const id = formData.get('id') as string | null;
		if (!id) return fail(400, { error: 'Missing tag id' });

		let q = db.from('nfc_tags').delete().eq('id', id);
		if (locals.user?.id) q = q.eq('created_by', locals.user.id);
		const { error } = await q;
		if (error) return fail(500, { error: error.message });
		return { success: true };
	}
};
