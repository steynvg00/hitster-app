import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';
import {
	activatePowerup,
	loadActiveEffects,
	getTeamsWithActiveTimedAttempt,
	parsePredictedPct,
	parseResurrectionChallengeId,
	submissionFinalScore
} from '$lib/server/powerups';
import { TEAM_COLOR_ORDER, getTeamsInSet } from '$lib/server/randomize';
import { parseBattleConfig } from '$lib/battle-ranking';
import { resurrectionRetrySeconds } from '$lib/powerups-meta';

/**
 * Teamfoto (fase 7A). Zelfde bucket die /admin/teams al gebruikt; die actie
 * blijft ongewijzigd bestaan naast deze.
 */
const TEAM_PHOTO_BUCKET = 'team-photos';
/** Ruim boven een client-gecropte JPEG (~100–300 kB); vangt alleen ongecropte bronnen af. */
const MAX_TEAM_PHOTO_BYTES = 5 * 1024 * 1024;

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

	// Hoogste teamscore, afgeleid uit dezelfde (aflopend gesorteerde) query —
	// geen extra request. Voedt de kroon-weergave in de banner: die toont bij
	// ELK team met score === topScore, en alleen als topScore > 0.
	const topScore = (allTeams ?? [])[0]?.score ?? 0;

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
	// points_config is selected only to derive the ⚔️ battle flag below — it is
	// destructured back OUT before the payload reaches the client (see challengeList).
	let challenges: Array<{
		id: string;
		title: string;
		variant: string;
		timer_seconds: number | null;
		nfc_lock_override: boolean | null;
		points_config: unknown;
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
				.select('id, title, variant, timer_seconds, nfc_lock_override, points_config')
				.in('id', setChallengeIds);
			// Preserve set order
			const posMap = new Map((scRows ?? []).map((sc) => [sc.challenge_id, sc.position]));
			challenges = (chs ?? []).sort((a, b) => (posMap.get(a.id) ?? 0) - (posMap.get(b.id) ?? 0));
		}
	} else {
		const { data: chs } = await supabase
			.from('challenges')
			.select('id, title, variant, timer_seconds, nfc_lock_override, points_config')
			.eq('is_active', true);
		challenges = chs ?? [];
	}

	const { data: submissions } = await supabase
		.from('submissions')
		.select('challenge_id, score')
		.eq('team_id', locals.teamId);

	const submittedMap = new Map((submissions ?? []).map((s) => [s.challenge_id, s.score]));

	// points_config is destructured OUT here: the list only needs the derived ⚔️
	// flag, so the raw config (max_points, field_modes, field_points…) never ships
	// to the client. Derived with parseBattleConfig — the same parser the resolver
	// and the admin editor use — so the badge can't drift from what actually resolves.
	const challengeList = challenges.map(({ points_config, ...c }) => ({
		...c,
		isBattle: parseBattleConfig(points_config).enabled,
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
		// Teamfoto (fase 7A): voedt de ronde avatar in de lobby-bubble. Zelfde
		// query, een kolom meer — geen extra request.
		photo_url: string | null;
		players: Array<{ id: string; display_name: string; photo_url: string | null }>;
	}> = [];

	let setTutorials: Array<{ variant: string; tutorial_text: string | null }> = [];
	let setCompletedCount = 0;
	let setTotalCount = 0;
	let challengeUnlocks: string[] = [];
	// The Resurrection picker's options — this team's finished challenges in the
	// active set, each with the score a retry would be measured against and the
	// 1/3 clock it would run on. Empty for a team that has finished nothing, which
	// is what makes the modal say so instead of offering an empty list.
	let resurrectableChallenges: Array<{
		id: string;
		title: string;
		variant: string;
		oldFinal: number;
		retrySeconds: number | null;
	}> = [];

	if (playerSetId) {
		{
			const { data: gs } = await admin
				.from('game_sets')
				.select(
					'id, status, play_state, name, recap_state, team_count, nfc_lock_enabled, crown_holder_team_id'
				)
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
						admin
							.from('teams')
							.select('id, color, display_name, photo_url')
							.in('color', scopedColors),
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

					// title + timer_seconds are for the Resurrection picker below (which
					// names the challenge and states its retry clock); variant drives the
					// tutorial lookup as before.
					const { data: setChallengeRows } = await admin
						.from('challenges')
						.select('id, variant, title, timer_seconds')
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

					// Count completions for this team. `answers` and `score` ride along for
					// the Resurrection picker below — same rows, so no second query.
					const { data: teamSubs } = await admin
						.from('submissions')
						.select('challenge_id, answers, score')
						.eq('team_id', locals.teamId)
						.eq('is_final', true)
						.in('challenge_id', challengeIds);
					setCompletedCount = (teamSubs ?? []).length;

					// ── Resurrection picker data ───────────────────────────────────────
					// Exactly the challenges this powerup can act on: the team's own, with
					// a FINISHED submission (is_final — the same definition the activation
					// guard enforces server-side, so the list can never offer something the
					// server would refuse).
					//
					// Each entry carries the score it would be measured against, from
					// submissionFinalScore — the same reader the activation uses to freeze
					// old_final into the ticket. A team must be able to see what it is
					// betting against BEFORE it spends a Tier S powerup.
					if (teamSubs?.length) {
						const finishedIds = teamSubs.map((s) => s.challenge_id);
						const chById = new Map(
							(setChallengeRows ?? [])
								.filter((c) => finishedIds.includes(c.id))
								.map((c) => [c.id, c])
						);
						resurrectableChallenges = teamSubs
							.filter((s) => chById.has(s.challenge_id))
							.map((s) => {
								const c = chById.get(s.challenge_id)!;
								return {
									id: c.id,
									title: c.title ?? 'Challenge',
									variant: c.variant,
									oldFinal: submissionFinalScore(s),
									// null on an untimed challenge — the modal says "no timer"
									// rather than promising a number that will not exist.
									retrySeconds: resurrectionRetrySeconds(c.timer_seconds)
								};
							})
							.sort((a, b) => a.title.localeCompare(b.title));
					}

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
				'id, powerup_type_id, granted_at, powerup_types(id, name, icon, description, holdable, immediate_use, category)'
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

	// Teams in this set — target list for offensive-powerup activation (stuk 1).
	// hasActiveTimedAttempt (stuk 2) lets the picker grey teams a timer attack
	// (freeze/time_drain) can't hit right now; give_a_shot ignores it.
	let setTeams: Array<{
		id: string;
		color: string;
		display_name: string;
		hasActiveTimedAttempt: boolean;
	}> = [];
	if (playerSetId) {
		const teams = await getTeamsInSet(admin, playerSetId);
		const timedTeamIds = await getTeamsWithActiveTimedAttempt(
			admin,
			teams.map((t) => t.id)
		);
		setTeams = teams.map((t) => ({ ...t, hasActiveTimedAttempt: timedTeamIds.has(t.id) }));
	}

	// Derive crown holder for this set (carried separately for reactivity)
	let crownHolderTeamId: string | null = null;
	if (playerSetId) {
		const { data: crownGs } = await admin
			.from('game_sets')
			.select('crown_holder_team_id')
			.eq('id', playerSetId)
			.maybeSingle();
		crownHolderTeamId = crownGs?.crown_holder_team_id ?? null;
	}

	return {
		team,
		position,
		totalTeams,
		topScore,
		challenges: challengeList,
		recentActivity: recentActivity ?? [],
		activeSet,
		lobbyTeams,
		setTutorials,
		setCompletedCount,
		setTotalCount,
		challengeUnlocks,
		resurrectableChallenges,
		heldPowerups,
		playerSetId,
		activeEffects,
		crownHolderTeamId,
		setTeams
	};
};

export const actions: Actions = {
	activatePowerup: async ({ request }) => {
		const admin = createAdminClient();
		const fd = await request.formData();
		const teamPowerupId = (fd.get('team_powerup_id') as string | null)?.trim();
		// Offensive activation from /team is the normal case — the caster needn't be
		// in a challenge, only forward the target. (give_a_shot has no attempt gate.)
		const targetTeamId = (fd.get('target_team_id') as string | null)?.trim() || undefined;
		if (!teamPowerupId) return fail(400, { activateError: 'Missing powerup ID' });
		const result = await activatePowerup(admin, teamPowerupId, {
			targetTeamId,
			...parsePredictedPct(fd),
			// resurrection is activated from HERE in the normal case: /team is where the
			// team can see every challenge it has finished, and picking one of them is
			// the whole decision. There is no currentChallengeId to fall back on, so the
			// picker's choice is the only address.
			...parseResurrectionChallengeId(fd)
		});
		if (!result.success) return fail(400, { activateError: result.error });
		// `payload` carries lucky_dice's roll — /team is a normal place to fire it
		// from, so the number has to come back here too.
		return {
			activated: true,
			payload: result.payload,
			blocked: result.blocked,
			// resurrection: the client sends the team to the re-opened challenge.
			resurrection: result.resurrection
		};
	},

	/**
	 * TEAMFOTO UPLOADEN (fase 7A).
	 *
	 * Kopie van ?/uploadPhoto op /admin/teams, met één wezenlijk verschil: het
	 * team komt uit `locals.teamId` (de HMAC-getekende `hitster_team`-cookie),
	 * NOOIT uit het formulier. Een speler kan dus alleen de foto van zijn eigen
	 * team zetten, ook al kan hij het request naar believen naspelen.
	 *
	 * CACHE-BUSTING: het pad is `${teamId}-${timestamp}.jpg`, niet
	 * `${teamId}.jpg` + upsert. Een nieuwe foto krijgt daardoor een NIEUWE
	 * publieke URL, zodat teamgenoten en het podium hem via de teams-realtime
	 * meteen zien in plaats van de gecachete oude. De oude objecten van dit team
	 * worden na de rij-update opgeruimd, dus de bucket groeit niet mee.
	 */
	uploadTeamPhoto: async ({ request, locals }) => {
		const teamId = locals.teamId;
		if (!teamId) return fail(401, { photoError: 'Geen team-sessie — scan je teamkaart opnieuw.' });

		const fd = await request.formData();
		const file = fd.get('photo');

		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { photoError: 'Geen foto ontvangen.' });
		}
		// Lege type-string komt voor bij sommige mobiele browsers; die laten we door.
		if (file.type && !file.type.startsWith('image/')) {
			return fail(400, { photoError: 'Alleen afbeeldingen.' });
		}
		if (file.size > MAX_TEAM_PHOTO_BYTES) {
			return fail(400, { photoError: 'Foto is te groot (max 5 MB).' });
		}

		const admin = createAdminClient();
		const path = `${teamId}-${Date.now()}.jpg`;

		const { error: uploadErr } = await admin.storage
			.from(TEAM_PHOTO_BUCKET)
			.upload(path, await file.arrayBuffer(), {
				contentType: file.type || 'image/jpeg',
				upsert: false
			});
		if (uploadErr) return fail(500, { photoError: `Upload mislukt: ${uploadErr.message}` });

		const {
			data: { publicUrl }
		} = admin.storage.from(TEAM_PHOTO_BUCKET).getPublicUrl(path);

		const { error: updateErr } = await admin
			.from('teams')
			.update({ photo_url: publicUrl } as never)
			.eq('id', teamId);

		if (updateErr) {
			// Rollback zoals het spelerspad dat doet: geen wees-object achterlaten.
			await admin.storage.from(TEAM_PHOTO_BUCKET).remove([path]);
			return fail(500, { photoError: `Opslaan mislukt: ${updateErr.message}` });
		}

		// Oude foto's van DIT team opruimen (ook de `${teamId}.ext` van het
		// admin-pad, die nu nergens meer naar verwijst). Faalt dit, dan is dat
		// geen reden de upload af te keuren — de nieuwe foto staat er al.
		const { data: existing } = await admin.storage
			.from(TEAM_PHOTO_BUCKET)
			.list('', { limit: 100, search: teamId });
		const stale = (existing ?? [])
			.map((o) => o.name)
			.filter((n) => n !== path && (n.startsWith(`${teamId}-`) || n.startsWith(`${teamId}.`)));
		if (stale.length > 0) await admin.storage.from(TEAM_PHOTO_BUCKET).remove(stale);

		return { photoUploaded: true, photoUrl: publicUrl };
	}
};
