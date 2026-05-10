import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (!locals.teamId) redirect(302, '/join');

	const supabase = createPublicClient(cookies);
	const admin = createAdminClient();

	const { data: team } = await supabase
		.from('teams')
		.select('*')
		.eq('id', locals.teamId)
		.single();

	if (!team) redirect(302, '/join');

	// Leaderboard position (1-based, sorted by score desc)
	const { data: allTeams } = await supabase
		.from('teams')
		.select('id, score')
		.order('score', { ascending: false });

	const position = ((allTeams ?? []).findIndex((t) => t.id === locals.teamId) + 1) || 1;
	const totalTeams = (allTeams ?? []).length;

	// Active challenges + this team's submission status
	const { data: challenges } = await supabase
		.from('challenges')
		.select('id, title, variant, timer_seconds')
		.eq('is_active', true);

	const { data: submissions } = await supabase
		.from('submissions')
		.select('challenge_id, score')
		.eq('team_id', locals.teamId);

	const submittedMap = new Map((submissions ?? []).map((s) => [s.challenge_id, s.score]));

	const challengeList = (challenges ?? []).map((c) => ({
		...c,
		status: submittedMap.has(c.id) ? ('completed' as const) : ('available' as const),
		earnedScore: submittedMap.get(c.id) ?? null
	}));

	// Recent activity for this team
	const { data: recentActivity } = await admin
		.from('activity_log')
		.select('id, event_type, payload, created_at')
		.eq('team_id', locals.teamId)
		.order('created_at', { ascending: false })
		.limit(8);

	// If player is in a set, load full set state
	let activeSet: {
		id: string;
		status: string;
		play_state: string;
		name: string;
		recap_state: string | null;
		nfc_lock_enabled: boolean;
	} | null = null;

	let lobbyTeams: Array<{
		id: string;
		color: string;
		display_name: string;
		players: Array<{ id: string; display_name: string; photo_url: string | null }>;
	}> = [];

	let setTutorials: Array<{ variant: string; tutorial_text: string | null }> = [];
	let setCompletedCount = 0;
	let setTotalCount = 0;
	let challengeUnlocks: string[] = [];

	if (locals.playerId) {
		const { data: player } = await admin
			.from('players')
			.select('set_id')
			.eq('id', locals.playerId)
			.maybeSingle();

		if (player?.set_id) {
			const { data: gs } = await admin
				.from('game_sets')
				.select('id, status, play_state, name, recap_state, team_count, nfc_lock_enabled')
				.eq('id', player.set_id)
				.maybeSingle();

			if (gs) {
				// Recap: redirect to waiting screen
				if (gs.play_state === 'recap') {
					redirect(302, `/play/waiting?set_id=${gs.id}`);
				}
				// Complete recap: redirect to thanks
				if (gs.recap_state === 'complete') {
					redirect(302, `/play/thanks?set_id=${gs.id}`);
				}

				activeSet = {
					id: gs.id,
					status: gs.status,
					play_state: gs.play_state ?? 'joining',
					name: gs.name,
					recap_state: gs.recap_state,
					nfc_lock_enabled: gs.nfc_lock_enabled ?? false
				};

				// For lobby view (joining state): load teams + players
				if (gs.play_state === 'joining') {
					const scopedColors = TEAM_COLOR_ORDER.slice(0, gs.team_count ?? 6);
					const [{ data: teams }, { data: players }] = await Promise.all([
						admin.from('teams').select('id, color, display_name').in('color', scopedColors),
						admin.from('players').select('id, display_name, photo_url, team_id').eq('set_id', gs.id)
					]);

					const sortedTeams = (teams ?? []).sort(
						(a, b) => TEAM_COLOR_ORDER.indexOf(a.color) - TEAM_COLOR_ORDER.indexOf(b.color)
					);

					lobbyTeams = sortedTeams.map((t) => ({
						...t,
						players: (players ?? []).filter((p) => p.team_id === t.id)
					}));
				}

				// Load tutorials for variants in this set
				const { data: setChallenges } = await admin
					.from('set_challenges')
					.select('challenge_id')
					.eq('set_id', gs.id);

				if (setChallenges && setChallenges.length > 0) {
					const challengeIds = setChallenges.map((sc) => sc.challenge_id);
					setTotalCount = challengeIds.length;

					const { data: setChallengeRows } = await admin
						.from('challenges')
						.select('id, variant')
						.in('id', challengeIds);

					const variants = [...new Set((setChallengeRows ?? []).map((c) => c.variant))];

					if (variants.length > 0) {
						const { data: tutorialRows } = await admin
							.from('variant_defaults')
							.select('variant, tutorial_text')
							.in('variant', variants);
						setTutorials = (tutorialRows ?? []).map((r) => ({
							variant: r.variant,
							tutorial_text: (r as { tutorial_text?: string | null }).tutorial_text ?? null
						}));
					}

					// Count completions for this team
					const { data: teamSubs } = await admin
						.from('submissions')
						.select('challenge_id')
						.eq('team_id', locals.teamId)
						.eq('is_final', true)
						.in('challenge_id', challengeIds);
					setCompletedCount = (teamSubs ?? []).length;

					// Load NFC unlocks for this team in this set
					if (gs.nfc_lock_enabled) {
						const { data: unlockRows } = await admin
							.from('challenge_unlocks')
							.select('challenge_id')
							.eq('team_id', locals.teamId)
							.eq('set_id', gs.id);
						challengeUnlocks = (unlockRows ?? []).map((r) => r.challenge_id);
					}
				}
			}
		}
	}

	return {
		team,
		position,
		totalTeams,
		challenges: challengeList,
		recentActivity: recentActivity ?? [],
		activeSet,
		lobbyTeams,
		setTutorials,
		setCompletedCount,
		setTotalCount,
		challengeUnlocks
	};
};
