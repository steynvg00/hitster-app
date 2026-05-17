import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';
import { activatePowerup, loadActiveEffects } from '$lib/server/powerups';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (!locals.teamId) redirect(302, '/join');

	const supabase = createPublicClient(cookies);
	const admin = createAdminClient();

	const { data: team } = await supabase.from('teams').select('*').eq('id', locals.teamId).single();

	if (!team) redirect(302, '/join');

	// Leaderboard position (1-based, sorted by score desc)
	const { data: allTeams } = await supabase
		.from('teams')
		.select('id, score')
		.order('score', { ascending: false });

	const position = (allTeams ?? []).findIndex((t) => t.id === locals.teamId) + 1 || 1;
	const totalTeams = (allTeams ?? []).length;

	// Determine active set_id for challenge filtering (resolved below with player lookup)
	let playerSetId: string | null = null;
	if (locals.playerId) {
		const { data: playerRow } = await admin
			.from('players')
			.select('set_id')
			.eq('id', locals.playerId)
			.maybeSingle();
		playerSetId = playerRow?.set_id ?? null;
	}

	// Challenges: scoped to player's set when in one, otherwise all active
	let challenges: Array<{
		id: string;
		title: string;
		variant: string;
		timer_seconds: number | null;
		nfc_lock_override: boolean | null;
	}> = [];
	if (playerSetId) {
		const { data: scRows } = await admin
			.from('set_challenges')
			.select('challenge_id, position')
			.eq('set_id', playerSetId)
			.order('position');
		const setChallengeIds = (scRows ?? []).map((sc) => sc.challenge_id);
		if (setChallengeIds.length > 0) {
			const { data: chs } = await supabase
				.from('challenges')
				.select('id, title, variant, timer_seconds, nfc_lock_override')
				.in('id', setChallengeIds);
			// Preserve set order
			const posMap = new Map((scRows ?? []).map((sc) => [sc.challenge_id, sc.position]));
			challenges = (chs ?? []).sort((a, b) => (posMap.get(a.id) ?? 0) - (posMap.get(b.id) ?? 0));
		}
	} else {
		const { data: chs } = await supabase
			.from('challenges')
			.select('id, title, variant, timer_seconds, nfc_lock_override')
			.eq('is_active', true);
		challenges = chs ?? [];
	}

	const { data: submissions } = await supabase
		.from('submissions')
		.select('challenge_id, score')
		.eq('team_id', locals.teamId);

	const submittedMap = new Map((submissions ?? []).map((s) => [s.challenge_id, s.score]));

	const challengeList = challenges.map((c) => ({
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

	if (playerSetId) {
		{
			const { data: gs } = await admin
				.from('game_sets')
				.select('id, status, play_state, name, recap_state, team_count, nfc_lock_enabled')
				.eq('id', playerSetId)
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

					// Load NFC unlocks for this team — needed when set lock is on OR any challenge overrides to true
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

	// Held powerups for this team in the active set
	let heldPowerups: Array<{
		id: string;
		powerup_type_id: string;
		granted_at: string;
		type: {
			id: string;
			name: string;
			icon: string | null;
			description: string | null;
			holdable: boolean;
			immediate_use: boolean;
		};
	}> = [];
	if (playerSetId) {
		const { data: hpRows } = await admin
			.from('team_powerups')
			.select(
				'id, powerup_type_id, granted_at, powerup_types(id, name, icon, description, holdable, immediate_use)'
			)
			.eq('team_id', locals.teamId)
			.eq('set_id', playerSetId)
			.eq('status', 'held')
			.order('granted_at');
		heldPowerups = (hpRows ?? []).map((r) => ({
			id: r.id,
			powerup_type_id: r.powerup_type_id,
			granted_at: r.granted_at ?? '',
			type: (
				r as unknown as {
					powerup_types: {
						id: string;
						name: string;
						icon: string | null;
						description: string | null;
						holdable: boolean;
						immediate_use: boolean;
					};
				}
			).powerup_types
		}));
	}

	// Active powerup effects for banner display
	let activeEffects: Array<{
		id: string;
		effect_type: string;
		payload: Record<string, unknown>;
		expires_at: string | null;
	}> = [];
	if (playerSetId && locals.teamId) {
		const effects = await loadActiveEffects(admin, locals.teamId, playerSetId);
		activeEffects = effects.map((e) => ({
			id: e.id,
			effect_type: e.effect_type,
			payload: e.payload,
			expires_at: e.expires_at
		}));
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
		challengeUnlocks,
		heldPowerups,
		playerSetId,
		activeEffects
	};
};

export const actions: Actions = {
	activatePowerup: async ({ request }) => {
		const admin = createAdminClient();
		const fd = await request.formData();
		const teamPowerupId = (fd.get('team_powerup_id') as string | null)?.trim();
		if (!teamPowerupId) return fail(400, { activateError: 'Missing powerup ID' });
		const result = await activatePowerup(admin, teamPowerupId);
		if (!result.success) return fail(400, { activateError: result.error });
		return { activated: true };
	}
};
