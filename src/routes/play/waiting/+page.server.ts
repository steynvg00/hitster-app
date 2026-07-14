import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';
import { getBattleRevealData } from '$lib/server/battle';

export const load: PageServerLoad = async ({ locals, cookies, url }) => {
	if (!locals.teamId) redirect(302, '/join');

	const setId = url.searchParams.get('set_id');
	if (!setId) redirect(302, '/team');

	const supabase = createPublicClient(cookies);
	const admin = createAdminClient();

	const [{ data: gs }, { data: team }] = await Promise.all([
		admin.from('game_sets').select('*').eq('id', setId).maybeSingle(),
		supabase.from('teams').select('id, color, display_name').eq('id', locals.teamId).maybeSingle()
	]);

	if (!gs) redirect(302, '/team');
	if (!gs.recap_state) redirect(302, '/team');
	if (gs.recap_state === 'complete') redirect(302, `/play/thanks?set_id=${setId}`);

	if (!team) redirect(302, '/join');

	// Compute rank info for the player's team (used to fire reveal animation)
	const scopedColors = TEAM_COLOR_ORDER.slice(0, gs.team_count);
	const [{ data: teams }, { data: setChallenges }] = await Promise.all([
		admin.from('teams').select('id, color').in('color', scopedColors),
		admin.from('set_challenges').select('challenge_id').eq('set_id', setId)
	]);

	const challengeIds = (setChallenges ?? []).map((sc) => sc.challenge_id);
	const teamSetScores = new Map<string, number>();
	if (challengeIds.length > 0) {
		const { data: subs } = await supabase
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

	// Ascending (last place first) — same as recap_ranking order
	const rankedTeamIds = (teams ?? [])
		.sort((a, b) => (teamSetScores.get(a.id) ?? 0) - (teamSetScores.get(b.id) ?? 0))
		.map((t) => t.id);

	// Player's rank position index in rankedTeamIds (0 = last place)
	const playerRankIndex = rankedTeamIds.indexOf(locals.teamId);
	// Position from top (1 = 1st place)
	const totalTeams = rankedTeamIds.length;
	const playerPosition = playerRankIndex === -1 ? null : totalTeams - playerRankIndex;

	const playerSetScore = teamSetScores.get(locals.teamId) ?? 0;

	// Load players in the player's team for the reveal card
	// Also load challenges for the waiting-room carousel + the battle reveal data
	// (stuk 3c — empty arrays for a non-battle set, so the surface renders no
	// battle UI at all and the recap looks exactly as it did pre-3c).
	const [{ data: teammates }, { data: challengeRows }, battleData] = await Promise.all([
		admin.from('players').select('id, display_name, photo_url').eq('set_id', setId).eq('team_id', locals.teamId),
		challengeIds.length
			? admin.from('challenges').select('id, title, variant').in('id', challengeIds)
			: Promise.resolve({ data: [] as { id: string; title: string; variant: string }[] }),
		getBattleRevealData(admin, setId)
	]);

	// Sort challenges by set position
	const posMap = new Map((setChallenges ?? []).map((sc, i) => [sc.challenge_id, i]));
	const carouselChallenges = (challengeRows ?? [])
		.sort((a, b) => (posMap.get(a.id) ?? 0) - (posMap.get(b.id) ?? 0))
		.map((c) => ({
			title: c.title,
			variant: c.variant,
			score: teamSetScores.get(locals.teamId ?? '') ?? 0
		}));

	return {
		setId,
		setName: gs.name,
		recapState: gs.recap_state,
		recapRanking: (gs.recap_ranking as string[]) ?? [],
		recapRevealIndex: gs.recap_reveal_index ?? 0,
		team,
		playerRankIndex,
		playerPosition,
		playerSetScore,
		teammates: teammates ?? [],
		totalTeams,
		carouselChallenges,
		// Battle reveal (stuk 3c): reveal-ordered battles + the teams map to resolve
		// battle_ranking's team_ids. battleRevealIndex says how many are revealed —
		// it advances live over the existing game_sets realtime channel.
		battles: battleData.battles,
		battleTeams: battleData.teams,
		battleRevealIndex: gs.battle_reveal_index ?? 0
	};
};
