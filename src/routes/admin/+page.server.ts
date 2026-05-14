import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { generateAssignmentSlots } from '$lib/server/randomize';

export const load: PageServerLoad = async ({ locals }) => {
	const db = createAdminClient();

	const [
		{ count: trackCount },
		{ count: challengeCount },
		{ count: setCount },
		{ count: nfcCount },
		{ data: activeSets },
		{ data: lastInactive },
		{ data: recentActivity },
		{ data: teams }
	] = await Promise.all([
		db.from('tracks').select('*', { count: 'exact', head: true }),
		db.from('challenges').select('*', { count: 'exact', head: true }),
		db.from('game_sets').select('*', { count: 'exact', head: true }),
		db.from('nfc_tags').select('*', { count: 'exact', head: true }),
		db
			.from('game_sets')
			.select('id, name, team_count, play_state, total_timer_seconds, started_at')
			.eq('status', 'active')
			.limit(1),
		db
			.from('game_sets')
			.select('id, name')
			.eq('status', 'inactive')
			.order('created_at', { ascending: false })
			.limit(1),
		db.from('activity_log').select('*').order('created_at', { ascending: false }).limit(10),
		db.from('teams').select('id, display_name, color')
	]);

	const activeSet = activeSets?.[0] ?? null;

	// Count players currently in the active set
	let activeSetPlayerCount = 0;
	if (activeSet) {
		const { count } = await db
			.from('players')
			.select('*', { count: 'exact', head: true })
			.eq('set_id', activeSet.id);
		activeSetPlayerCount = count ?? 0;
	}

	return {
		stats: {
			tracks: trackCount ?? 0,
			challenges: challengeCount ?? 0,
			sets: setCount ?? 0,
			nfcTags: nfcCount ?? 0
		},
		activeSet: activeSet
			? {
					id: activeSet.id,
					name: activeSet.name,
					team_count: activeSet.team_count,
					play_state: (activeSet.play_state ?? 'joining') as 'joining' | 'playing' | 'recap',
					player_count: activeSetPlayerCount,
					total_timer_seconds: activeSet.total_timer_seconds ?? null,
					started_at: activeSet.started_at ?? null
				}
			: null,
		lastInactiveSet: lastInactive?.[0] ?? null,
		recentActivity: recentActivity ?? [],
		teams: teams ?? [],
		user: {
			email: locals.user?.email ?? null,
			avatarUrl: (locals.user?.user_metadata?.avatar_url as string | undefined) ?? null,
			displayName:
				(locals.user?.user_metadata?.full_name as string | undefined) ??
				locals.user?.email?.split('@')[0] ??
				'Host'
		}
	};
};

export const actions: Actions = {
	runLastSet: async () => {
		const db = createAdminClient();

		const { data: sets } = await db
			.from('game_sets')
			.select('id, team_count, expected_player_count')
			.eq('status', 'inactive')
			.order('created_at', { ascending: false })
			.limit(1);

		const gameSet = sets?.[0];
		if (!gameSet) return fail(404, { error: 'No inactive set found' });

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
			.eq('id', gameSet.id);

		if (error) return fail(500, { error: 'Could not activate set' });
		return { activated: true };
	},

	startGame: async () => {
		const db = createAdminClient();

		const { data: sets } = await db
			.from('game_sets')
			.select('id, play_state')
			.eq('status', 'active')
			.limit(1);

		const gameSet = sets?.[0];
		if (!gameSet) return fail(404, { error: 'No active set found' });
		if (gameSet.play_state !== 'joining') return fail(400, { error: 'Game already started' });

		const { error } = await db
			.from('game_sets')
			.update({ play_state: 'playing', started_at: new Date().toISOString() })
			.eq('id', gameSet.id);

		if (error) return fail(500, { error: 'Could not start game' });
		return { gameStarted: true };
	},

	endGame: async () => {
		const db = createAdminClient();

		const { data: sets } = await db
			.from('game_sets')
			.select('id, play_state')
			.eq('status', 'active')
			.limit(1);

		const gameSet = sets?.[0];
		if (!gameSet) return fail(404, { error: 'No active set found' });
		if (gameSet.play_state !== 'playing')
			return fail(400, { error: 'Game is not in playing state' });

		const { error } = await db
			.from('game_sets')
			.update({ play_state: 'recap', ended_at: new Date().toISOString() })
			.eq('id', gameSet.id);

		if (error) return fail(500, { error: 'Could not end game' });
		return { gameEnded: true };
	}
};
