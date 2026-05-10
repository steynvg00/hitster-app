import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { generateAssignmentSlots, TEAM_COLOR_ORDER } from '$lib/server/randomize';

export const load: PageServerLoad = async ({ params }) => {
	const db = createAdminClient();
	const { id } = params;

	const [{ data: gameSet }, { data: setChallengesRaw }, { data: allChallenges }, { data: cards }] =
		await Promise.all([
			db.from('game_sets').select('*').eq('id', id).maybeSingle(),
			db.from('set_challenges').select('id, challenge_id, position, challenge_multiplier').eq('set_id', id).order('position'),
			db.from('challenges').select('id, title, variant, is_active').order('title'),
			db.from('nfc_tags').select('id, set_id').eq('purpose', 'randomizer').eq('set_id', id)
		]);

	if (!gameSet) redirect(302, '/admin/sets');

	const setChallenges = setChallengesRaw ?? [];
	const challengeIds = setChallenges.map((sc) => sc.challenge_id);

	// Player count + recently joined (for console joining state)
	const [{ data: players }, unlockTagsResult] = await Promise.all([
		db.from('players').select('id, display_name, created_at').eq('set_id', id).order('created_at', { ascending: false }),
		// Load challenge_unlock NFC tags for this set (purpose: challenge_unlock, set_id match)
		db.from('nfc_tags').select('id, challenge_id').eq('purpose', 'challenge_unlock').eq('set_id', id)
	]);

	const playerList = players ?? [];
	const playerCount = playerList.length;
	const recentPlayers = playerList.slice(0, 5).map((p) => p.display_name);

	// Team progress (for console playing state)
	let teamProgress: Array<{ name: string; done: number; total: number }> = [];
	if (gameSet.play_state === 'playing' && challengeIds.length > 0) {
		const scopedColors = TEAM_COLOR_ORDER.slice(0, gameSet.team_count);
		const [{ data: teams }, { data: subs }] = await Promise.all([
			db.from('teams').select('id, display_name, color').in('color', scopedColors),
			db.from('submissions').select('team_id, challenge_id').eq('is_final', true).in('challenge_id', challengeIds)
		]);
		const subsByTeam = new Map<string, number>();
		for (const s of subs ?? []) {
			if (s.team_id) subsByTeam.set(s.team_id, (subsByTeam.get(s.team_id) ?? 0) + 1);
		}
		teamProgress = (teams ?? [])
			.sort((a, b) => TEAM_COLOR_ORDER.indexOf(a.color) - TEAM_COLOR_ORDER.indexOf(b.color))
			.map((t) => ({ name: t.display_name, done: subsByTeam.get(t.id) ?? 0, total: challengeIds.length }));
	}

	const challengeUnlockTags = (unlockTagsResult.data ?? []).map((t) => ({
		challenge_id: t.challenge_id ?? '',
		slug: t.id
	}));

	return {
		gameSet,
		setChallenges,
		allChallenges: allChallenges ?? [],
		cards: cards ?? [],
		playerCount,
		recentPlayers,
		teamProgress,
		challengeUnlockTags
	};
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
		const raw = (formData.get('challenge_ids') as string | null) ?? '';
		const challengeIds = raw.split(',').map((s) => s.trim()).filter(Boolean);

		let multipliersMap: Record<string, number> = {};
		try { multipliersMap = JSON.parse((formData.get('multipliers_json') as string | null) ?? '{}'); } catch { /* ok */ }

		let nfcSlugsMap: Record<string, string> = {};
		try { nfcSlugsMap = JSON.parse((formData.get('nfc_slugs_json') as string | null) ?? '{}'); } catch { /* ok */ }

		const nfcLockEnabled = (formData.get('nfc_lock_enabled') as string | null) === 'true';

		// Update nfc_lock_enabled on the set
		await db.from('game_sets').update({ nfc_lock_enabled: nfcLockEnabled }).eq('id', params.id);

		// Rebuild set_challenges
		await db.from('set_challenges').delete().eq('set_id', params.id);
		if (challengeIds.length > 0) {
			const rows = challengeIds.map((challenge_id, i) => ({
				set_id: params.id,
				challenge_id,
				position: i,
				challenge_multiplier: Math.max(1, parseInt(String(multipliersMap[challenge_id] ?? 1), 10) || 1),
				created_by: locals.user?.id ?? null
			}));
			const { error } = await db.from('set_challenges').insert(rows);
			if (error) return fail(500, { error: 'Could not save challenges' });
		}

		// Update NFC unlock tags: remove old ones for this set, add new ones from nfcSlugsMap
		await db.from('nfc_tags').delete().eq('purpose', 'challenge_unlock').eq('set_id', params.id);
		const unlockTagRows = Object.entries(nfcSlugsMap)
			.filter(([, slug]) => slug.trim())
			.map(([challenge_id, slug]) => ({
				id: slug.trim(),
				purpose: 'challenge_unlock' as const,
				challenge_id,
				set_id: params.id,
				created_by: locals.user?.id ?? null
			}));
		if (unlockTagRows.length > 0) {
			const { error } = await db.from('nfc_tags').upsert(unlockTagRows, { ignoreDuplicates: false });
			if (error) return fail(500, { error: `Could not save NFC unlock tags: ${error.message}` });
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
			let assignment_slots: string[] = [];
			if (gameSet.expected_player_count && gameSet.expected_player_count > 0) {
				assignment_slots = await generateAssignmentSlots(db, gameSet.expected_player_count, gameSet.team_count);
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

	toggleRandomizer: async ({ params }) => {
		const db = createAdminClient();
		const { data: gs } = await db.from('game_sets').select('randomizer_enabled').eq('id', params.id).maybeSingle();
		if (!gs) return fail(404, { error: 'Set not found' });
		await db.from('game_sets').update({ randomizer_enabled: !gs.randomizer_enabled }).eq('id', params.id);
		return { success: true };
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
			.update({ play_state: 'playing', started_at: new Date().toISOString() })
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
			.update({ play_state: 'recap', recap_state: 'pending', ended_at: new Date().toISOString() })
			.eq('id', params.id);

		if (error) return fail(500, { error: 'Could not start recap' });
		redirect(303, `/admin/sets/${params.id}/recap`);
	},

	resetGame: async ({ params }) => {
		const db = createAdminClient();
		const setId = params.id;

		// Load set + scoped team IDs
		const { data: gs } = await db.from('game_sets').select('team_count').eq('id', setId).maybeSingle();
		if (!gs) return fail(404, { error: 'Set not found' });

		const scopedColors = TEAM_COLOR_ORDER.slice(0, gs.team_count);
		const { data: teams } = await db.from('teams').select('id, display_name, score, color').in('color', scopedColors);
		const teamIds = (teams ?? []).map((t) => t.id);

		// Get challenge IDs in this set
		const { data: setChallenges } = await db.from('set_challenges').select('challenge_id').eq('set_id', setId);
		const challengeIds = (setChallenges ?? []).map((sc) => sc.challenge_id);

		// Capture rankings BEFORE clearing
		const sortedTeams = (teams ?? []).sort((a, b) => b.score - a.score);
		const last_results = sortedTeams.map((t, i) => ({
			rank: i + 1,
			team_id: t.id,
			team_name: t.display_name,
			score: t.score,
			photo_url: null
		}));

		// Clear game state scoped to this set
		if (challengeIds.length > 0) {
			// Find submission IDs to clean up review_requests
			const { data: subRows } = await db
				.from('submissions')
				.select('id')
				.in('challenge_id', challengeIds)
				.in('team_id', teamIds);
			const subIds = (subRows ?? []).map((s) => s.id);

			await Promise.all([
				db.from('challenge_attempts').delete().in('challenge_id', challengeIds),
				db.from('challenge_hints_used').delete().in('challenge_id', challengeIds),
				db.from('challenge_unlocks').delete().eq('set_id', setId),
				subIds.length > 0
					? db.from('review_requests').delete().in('submission_id', subIds)
					: Promise.resolve(),
				db.from('submissions').delete().in('challenge_id', challengeIds).in('team_id', teamIds)
			]);
		} else {
			await db.from('challenge_unlocks').delete().eq('set_id', setId);
		}

		// Clear activity log for this set's teams (heuristic: all team activity)
		if (teamIds.length > 0) {
			await db.from('activity_log').delete().in('team_id', teamIds);
		}

		// Reset team scores + streaks
		if (teamIds.length > 0) {
			await db.from('teams').update({ score: 0, current_streak: 0 }).in('id', teamIds);
		}

		// Clear player sessions
		await db.from('players').update({ set_id: null, team_id: null }).eq('set_id', setId);

		// Reset set state + persist last_results
		const { error } = await db.from('game_sets').update({
			play_state: 'joining',
			started_at: null,
			ended_at: null,
			scores_hidden: false,
			recap_ranking: [] as never,
			recap_reveal_index: 0,
			recap_state: 'pending',
			assignment_slots: [] as never,
			assignment_index: 0,
			last_results: last_results as never
		}).eq('id', setId);

		if (error) return fail(500, { error: 'Could not reset game' });
		return { success: true };
	},

	delete: async ({ params }) => {
		const db = createAdminClient();

		const { data: gameSet } = await db.from('game_sets').select('status').eq('id', params.id).maybeSingle();
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
				const { data: existing } = await db.from('nfc_tags').select('purpose, set_id, challenge_id').eq('id', slug).maybeSingle();
				let existingTagUrl: string | null = null;
				if (existing) {
					if (existing.purpose === 'randomizer') existingTagUrl = existing.set_id ? `/admin/sets/${existing.set_id}` : '/admin/nfc-tags';
					else if (existing.purpose === 'challenge') existingTagUrl = existing.challenge_id ? `/admin/challenges/${existing.challenge_id}` : '/admin/nfc-tags';
					else existingTagUrl = '/admin/nfc-tags';
				}
				return fail(400, { error: `Slug "${slug}" is already assigned to another tag.`, existingTagUrl, existingTagPurpose: existing?.purpose ?? null });
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
