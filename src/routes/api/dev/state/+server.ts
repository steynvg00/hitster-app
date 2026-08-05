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

	// The powerup catalog, so DevNav's two powerup tools don't have to carry a
	// hardcoded copy of it. That copy went stale on every new powerup (lifeline was
	// missing, then power_spin) because nothing links the literal to the catalog —
	// there is no build step or type that fails when they drift apart, only someone
	// noticing a gap in a dropdown.
	//
	// NO filter on coming_soon. This feeds a TEST tool: being able to force a
	// half-built powerup is the point, and both dev paths already accept any id
	// (the award endpoint inserts powerup_type_id verbatim; the force cookie is
	// looked up with a plain .eq). The UI marks placeholders instead of hiding them.
	//
	// `sort_order` is the catalog's own display order, the same one the admin
	// console lists by, so the dropdown matches what the host sees.
	const { data: powerupTypesData } = await db
		.from('powerup_types')
		.select('id, name, icon, category, coming_soon')
		.order('sort_order');

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
		})),
		powerup_types: (powerupTypesData ?? []).map((p) => ({
			id: p.id,
			name: p.name,
			icon: p.icon,
			category: p.category,
			coming_soon: p.coming_soon
		}))
	});
};
