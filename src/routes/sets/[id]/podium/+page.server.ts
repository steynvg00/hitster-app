import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';
import { getBattleRevealData } from '$lib/server/battle';

export const load: PageServerLoad = async ({ params }) => {
	const db = createAdminClient();
	const { id } = params;

	const { data: gameSet } = await db.from('game_sets').select('*').eq('id', id).maybeSingle();
	if (!gameSet) redirect(302, '/');

	const scopedColors = TEAM_COLOR_ORDER.slice(0, gameSet.team_count);

	const [{ data: teams }, { data: setChallenges }, { data: players }, battleData] =
		await Promise.all([
			db.from('teams').select('id, color, display_name').in('color', scopedColors),
			db.from('set_challenges').select('challenge_id').eq('set_id', id),
			db.from('players').select('id, display_name, photo_url, team_id').eq('set_id', id),
			// Battle reveal (stuk 3c) — empty for a non-battle set, so the podium
			// renders no battle panel and looks exactly as it did pre-3c.
			getBattleRevealData(db, id)
		]);

	const challengeIds = (setChallenges ?? []).map((sc) => sc.challenge_id);
	const teamSetScores = new Map<string, number>();
	if (challengeIds.length > 0) {
		const { data: subs } = await db
			.from('submissions')
			.select('team_id, score')
			.in('challenge_id', challengeIds)
			.eq('is_final', true);
		for (const sub of subs ?? []) {
			if (sub.team_id) {
				teamSetScores.set(sub.team_id, (teamSetScores.get(sub.team_id) ?? 0) + (sub.score ?? 0));
			}
		}
	}

	// Sort ascending (last place first, matching recap_ranking order)
	const rankedTeams = (teams ?? [])
		.map((t) => ({ ...t, setScore: teamSetScores.get(t.id) ?? 0 }))
		.sort((a, b) => a.setScore - b.setScore);

	const playersByTeam: Record<string, { id: string; display_name: string; photo_url: string | null }[]> = {};
	for (const t of rankedTeams) playersByTeam[t.id] = [];
	for (const p of players ?? []) {
		if (p.team_id && playersByTeam[p.team_id]) {
			playersByTeam[p.team_id]!.push(p);
		}
	}

	return {
		gameSet,
		rankedTeams,
		playersByTeam,
		setName: gameSet.name,
		// Battle reveal (stuk 3c): position-ordered battles + the teams map for
		// battle_ranking's team_ids. battle_reveal_index arrives live on the
		// existing game_sets channel.
		battles: battleData.battles,
		battleTeams: battleData.teams
	};
};
