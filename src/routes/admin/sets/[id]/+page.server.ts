import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { generateAssignmentSlots } from '$lib/server/randomize';

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
		const timer_raw = (formData.get('total_timer_minutes') as string | null)?.trim();
		const total_timer_seconds = timer_raw ? (parseInt(timer_raw) || 0) * 60 || null : null;
		const epc_raw = (formData.get('expected_player_count') as string | null)?.trim();
		const expected_player_count = epc_raw ? parseInt(epc_raw) || null : null;

		if (!name) return fail(400, { error: 'Name is required' });
		if (team_count < 2 || team_count > 6) return fail(400, { error: 'Team count must be 2–6' });

		const { error } = await db
			.from('game_sets')
			.update({ name, description, team_count, total_timer_seconds, expected_player_count })
			.eq('id', params.id);

		if (error) return fail(500, { error: 'Update failed' });
		return { success: true };
	},

	setChallenges: async ({ request, params, locals }) => {
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
				position: i,
				created_by: locals.user?.id ?? null
			}));
			const { error } = await db.from('set_challenges').insert(rows);
			if (error) return fail(500, { error: 'Could not save challenges' });
		}

		return { success: true };
	},

	toggle: async ({ params }) => {
		const db = createAdminClient();

		const { data: gameSet } = await db
			.from('game_sets')
			.select('id, status, team_count, expected_player_count')
			.eq('id', params.id)
			.maybeSingle();

		if (!gameSet) return fail(404, { error: 'Set not found' });

		if (gameSet.status === 'active') {
			const { error } = await db
				.from('game_sets')
				.update({ status: 'inactive', play_state: 'joining' })
				.eq('id', params.id);
			if (error) return fail(500, { error: 'Could not deactivate set' });
			return { success: true };
		} else {
			// Activating: regenerate slots, reset recap state, start in joining phase
			let assignment_slots: string[] = [];
			if (gameSet.expected_player_count && gameSet.expected_player_count > 0) {
				assignment_slots = await generateAssignmentSlots(
					db,
					gameSet.expected_player_count,
					gameSet.team_count
				);
			}
			const { error } = await db
				.from('game_sets')
				.update({
					status: 'active',
					play_state: 'joining',
					started_at: new Date().toISOString(),
					ended_at: null,
					recap_state: 'pending',
					recap_ranking: [] as never,
					recap_reveal_index: 0,
					assignment_slots: assignment_slots as never,
					assignment_index: 0
				})
				.eq('id', params.id);
			if (error) return fail(500, { error: 'Could not activate set' });
			redirect(303, `/admin/sets/${params.id}/lobby`);
		}
	},

	startGame: async ({ params }) => {
		const db = createAdminClient();

		const { data: gameSet } = await db
			.from('game_sets')
			.select('id, status, play_state')
			.eq('id', params.id)
			.maybeSingle();

		if (!gameSet || gameSet.status !== 'active') return fail(400, { error: 'Set must be active' });
		if (gameSet.play_state !== 'joining') return fail(400, { error: 'Game already started' });

		const { error } = await db
			.from('game_sets')
			.update({ play_state: 'playing' })
			.eq('id', params.id);

		if (error) return fail(500, { error: 'Could not start game' });
		redirect(303, `/admin/live`);
	},

	startRecap: async ({ params }) => {
		const db = createAdminClient();

		const { data: gameSet } = await db
			.from('game_sets')
			.select('id, status, play_state')
			.eq('id', params.id)
			.maybeSingle();

		if (!gameSet || gameSet.status !== 'active') return fail(400, { error: 'Set must be active to start recap' });
		if (gameSet.play_state === 'recap') return fail(400, { error: 'Recap already started' });

		const { error } = await db
			.from('game_sets')
			.update({ play_state: 'recap', recap_state: 'pending' })
			.eq('id', params.id);

		if (error) return fail(500, { error: 'Could not start recap' });
		redirect(303, `/admin/sets/${params.id}/recap`);
	},

	delete: async ({ params }) => {
		const db = createAdminClient();

		const { data: gameSet } = await db
			.from('game_sets')
			.select('status')
			.eq('id', params.id)
			.maybeSingle();

		if (gameSet?.status === 'active') return fail(400, { error: 'Cannot delete an active set' });

		await db.from('game_sets').delete().eq('id', params.id);
		redirect(303, '/admin/sets');
	},

	addCard: async ({ request, params, locals }) => {
		const db = createAdminClient();
		const formData = await request.formData();
		const slug = (formData.get('slug') as string | null)?.trim() ?? '';

		if (!slug) return fail(400, { error: 'Card slug is required' });

		const { error } = await db
			.from('nfc_tags')
			.insert({ id: slug, purpose: 'randomizer', set_id: params.id, created_by: locals.user?.id ?? null });

		if (error) {
			if (error.code === '23505') {
				const { data: existing } = await db
					.from('nfc_tags')
					.select('purpose, set_id, challenge_id')
					.eq('id', slug)
					.maybeSingle();
				let existingTagUrl: string | null = null;
				if (existing) {
					if (existing.purpose === 'randomizer') {
						existingTagUrl = existing.set_id
							? `/admin/sets/${existing.set_id}`
							: '/admin/nfc-tags';
					} else if (existing.purpose === 'challenge') {
						existingTagUrl = existing.challenge_id
							? `/admin/challenges/${existing.challenge_id}`
							: '/admin/nfc-tags';
					} else {
						existingTagUrl = '/admin/nfc-tags';
					}
				}
				return fail(400, {
					error: `Slug "${slug}" is already assigned to another tag.`,
					existingTagUrl,
					existingTagPurpose: existing?.purpose ?? null
				});
			}
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
