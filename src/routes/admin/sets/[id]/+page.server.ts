import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ params }) => {
	const db = createAdminClient();
	const { id } = params;

	const [{ data: gameSet }, { data: setChallengess }, { data: allChallenges }, { data: cards }] =
		await Promise.all([
			db.from('game_sets').select('*').eq('id', id).maybeSingle(),
			db
				.from('set_challenges')
				.select('id, challenge_id, position')
				.eq('set_id', id)
				.order('position'),
			db.from('challenges').select('id, title, variant, is_active').order('title'),
			db.from('nfc_tags').select('id, set_id').eq('purpose', 'randomizer').eq('set_id', id)
		]);

	if (!gameSet) redirect(302, '/admin/sets');

	return { gameSet, setChallenges: setChallengess ?? [], allChallenges: allChallenges ?? [], cards: cards ?? [] };
};

export const actions: Actions = {
	update: async ({ request, params }) => {
		const db = createAdminClient();
		const formData = await request.formData();
		const name = (formData.get('name') as string | null)?.trim() ?? '';
		const description = (formData.get('description') as string | null)?.trim() || null;
		const team_count = parseInt(formData.get('team_count') as string) || 6;
		const timer_raw = (formData.get('total_timer_seconds') as string | null)?.trim();
		const total_timer_seconds = timer_raw ? parseInt(timer_raw) || null : null;

		if (!name) return fail(400, { error: 'Name is required' });
		if (team_count < 2 || team_count > 6) return fail(400, { error: 'Team count must be 2–6' });

		const { error } = await db
			.from('game_sets')
			.update({ name, description, team_count, total_timer_seconds })
			.eq('id', params.id);

		if (error) return fail(500, { error: 'Update failed' });
		return { success: true };
	},

	setChallenges: async ({ request, params }) => {
		const db = createAdminClient();
		const formData = await request.formData();
		// challenge_ids is a comma-separated ordered list
		const raw = (formData.get('challenge_ids') as string | null) ?? '';
		const challengeIds = raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		// Delete existing then re-insert in order
		await db.from('set_challenges').delete().eq('set_id', params.id);

		if (challengeIds.length > 0) {
			const rows = challengeIds.map((challenge_id, i) => ({
				set_id: params.id,
				challenge_id,
				position: i
			}));
			const { error } = await db.from('set_challenges').insert(rows);
			if (error) return fail(500, { error: 'Could not save challenges' });
		}

		return { success: true };
	},

	activate: async ({ params }) => {
		const db = createAdminClient();
		const { error } = await db
			.from('game_sets')
			.update({ status: 'active', started_at: new Date().toISOString() })
			.eq('id', params.id)
			.eq('status', 'draft');

		if (error) return fail(500, { error: 'Could not activate set' });
		redirect(303, `/admin/sets/${params.id}/lobby`);
	},

	end: async ({ params }) => {
		const db = createAdminClient();

		// Clear player assignments for this set
		await db.from('players').update({ set_id: null, team_id: null }).eq('set_id', params.id);

		const { error } = await db
			.from('game_sets')
			.update({ status: 'completed', ended_at: new Date().toISOString() })
			.eq('id', params.id);

		if (error) return fail(500, { error: 'Could not end set' });
		return { success: true };
	},

	delete: async ({ params }) => {
		const db = createAdminClient();

		const { data: gameSet } = await db
			.from('game_sets')
			.select('status')
			.eq('id', params.id)
			.maybeSingle();

		if (gameSet?.status !== 'draft') return fail(400, { error: 'Only draft sets can be deleted' });

		await db.from('game_sets').delete().eq('id', params.id);
		redirect(303, '/admin/sets');
	},

	addCard: async ({ request, params }) => {
		const db = createAdminClient();
		const formData = await request.formData();
		const slug = (formData.get('slug') as string | null)?.trim() ?? '';

		if (!slug) return fail(400, { error: 'Card slug is required' });

		const { error } = await db
			.from('nfc_tags')
			.insert({ id: slug, purpose: 'randomizer', set_id: params.id });

		if (error) {
			if (error.code === '23505') return fail(400, { error: `Slug "${slug}" already exists` });
			return fail(500, { error: 'Could not add card' });
		}
		return { success: true };
	},

	removeCard: async ({ request }) => {
		const db = createAdminClient();
		const formData = await request.formData();
		const slug = formData.get('slug') as string | null;
		if (!slug) return fail(400, { error: 'Missing slug' });

		await db.from('nfc_tags').delete().eq('id', slug).eq('purpose', 'randomizer');
		return { success: true };
	}
};
