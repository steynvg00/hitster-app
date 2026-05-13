import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { getTeamIdFromCookie } from '$lib/server/team';

export const GET: RequestHandler = async ({ locals, cookies }) => {
	if (!import.meta.env.DEV) {
		return new Response(null, { status: 403 });
	}

	const db = createAdminClient();

	const user = locals.user ? { id: locals.user.id, email: locals.user.email ?? null } : null;

	const teamId = getTeamIdFromCookie(cookies);
	let team_cookie: string | null = null;
	if (teamId) {
		const { data: team } = await db.from('teams').select('color').eq('id', teamId).maybeSingle();
		team_cookie = team?.color ?? null;
	}

	const { data: activeSetData } = await db
		.from('game_sets')
		.select('id, name, play_state')
		.eq('status', 'active')
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	const { data: recentSetsData } = await db
		.from('game_sets')
		.select('id, name, status, created_at')
		.order('created_at', { ascending: false })
		.limit(10);

	const { data: recentChallengesData } = await db
		.from('challenges')
		.select('id, title, variant, status')
		.order('created_at', { ascending: false })
		.limit(10);

	return json({
		user,
		team_cookie,
		active_set: activeSetData
			? { id: activeSetData.id, name: activeSetData.name, play_state: activeSetData.play_state }
			: null,
		recent_sets: (recentSetsData ?? []).map((s) => ({
			id: s.id,
			name: s.name,
			status: s.status,
			created_at: s.created_at
		})),
		recent_challenges: (recentChallengesData ?? []).map((c) => ({
			id: c.id,
			name: c.title,
			variant: c.variant,
			status: c.status
		}))
	});
};
