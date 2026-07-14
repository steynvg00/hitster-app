import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';
import { isNfcUnlockRequired } from '$lib/server/nfc';
import {
	resolvePowerupChoice,
	activatePowerup,
	loadActiveEffects,
	getTeamsWithActiveTimedAttempt,
	type EarnedPowerup
} from '$lib/server/powerups';
import { scoreAndPersistSubmission } from '$lib/server/submit';
import { getTeamsInSet } from '$lib/server/randomize';
import type { AnswerField, ChallengeResult, TabAnswer, EffectsConfig } from '$lib/types/index.js';
import {
	resolveChallengeFields,
	fieldMapsFromResolved,
	FIELD_POOL_TABLE,
	DEFAULT_FIELD_MAX,
	buildFieldResults,
	getSourceTracksForTab,
	type TrackData,
	type SlotDraft,
	type TabClipData,
	type TabSourceTrackRaw,
	type MashupSourceRaw,
	type ClipRaw
} from '$lib/server/scoring.js';

// ─── Load ────────────────────────────────────────────────────────────────────

export const load: PageServerLoad = async ({ params, cookies, locals, url }) => {
	if (!locals.teamId) redirect(302, `/join?redirect=/challenge/${params.id}`);

	const showHint = url.searchParams.get('hint') === '1';

	const supabase = createPublicClient(cookies);
	const admin = createAdminClient();

	const { data: challenge, error: challengeErr } = await supabase
		.from('challenges')
		.select('*')
		.eq('id', params.id)
		.single();

	if (challengeErr || !challenge) error(404, 'Challenge not found');

	// Fetch tabs for this challenge
	const { data: tabsRaw, error: tabErr } = await supabase
		.from('challenge_tabs')
		.select('*')
		.eq('challenge_id', params.id)
		.order('position');

	if (tabErr) error(500, `Failed to load challenge tabs: ${tabErr.message}`);

	// No tabs yet is a normal authoring state (draft/incomplete challenge), not
	// a server error — surface it as a friendly in-page message instead of a
	// hard 500. `tabs` stays a plain array from here on; every downstream
	// query/map already tolerates an empty challenge_tabs set.
	const tabs = tabsRaw ?? [];
	const challengeNotReady = tabs.length === 0;

	const tabIds = tabs.map((t) => t.id);

	const [sourceTracksResult, tabClipsResult, teamResult, attemptResult] = await Promise.all([
		admin.from('challenge_tab_source_tracks').select('*').in('tab_id', tabIds).order('sort_order'),
		admin.from('challenge_tab_clips').select('*').in('tab_id', tabIds).order('sort_order'),
		supabase.from('teams').select('*').eq('id', locals.teamId).single(),
		admin
			.from('challenge_attempts')
			.select('*')
			.eq('challenge_id', params.id)
			.eq('team_id', locals.teamId)
			.maybeSingle()
	]);

	if (!teamResult.data) redirect(302, '/join');
	const team = teamResult.data;

	const sourceTracks = sourceTracksResult.data ?? [];
	const tabClips = tabClipsResult.data ?? [];

	// For mashup variant: load mashup records + sources
	const mashupIds =
		challenge.variant === 'mashup'
			? [
					...new Set(
						tabs
							.map((t) => (t as unknown as { mashup_id?: string | null }).mashup_id)
							.filter((id): id is string => !!id)
					)
				]
			: [];
	const [{ data: mashupRows }, { data: mashupSourceRows }] = await (mashupIds.length
		? Promise.all([
				admin.from('mashups').select('id, audio_storage_path').in('id', mashupIds),
				admin.from('mashup_sources').select('*').in('mashup_id', mashupIds).order('sort_order')
			])
		: Promise.resolve([{ data: [] }, { data: [] }]));

	// Map mashup_id → public audio URL
	const mashupAudioUrlMap = new Map<string, string>(
		(mashupRows ?? []).map((m) => [
			m.id,
			m.audio_storage_path
				? admin.storage.from('audio').getPublicUrl(m.audio_storage_path).data.publicUrl
				: ''
		])
	);

	const mashupSources: MashupSourceRaw[] = (mashupSourceRows ?? []).map((r) => ({
		id: r.id,
		mashup_id: r.mashup_id,
		track_id: r.track_id,
		sort_order: r.sort_order
	}));

	// Collect all referenced track IDs (including mashup sources)
	const clipIds = [...new Set(tabClips.map((c) => c.clip_id))];

	// Fetch clips first — for fragments the source tracks are derived from clip.track_id,
	// so we need the clip rows before we can build the full trackIds list.
	const clipsResult = await (clipIds.length
		? supabase.from('clips').select('id, track_id, storage_path, type').in('id', clipIds)
		: Promise.resolve({
				data: [] as {
					id: string;
					track_id: string;
					storage_path: string;
					type: string;
				}[]
			}));

	const trackIds = [
		...new Set([
			...sourceTracks.map((s) => s.track_id),
			...mashupSources.map((s) => s.track_id),
			...(clipsResult.data ?? []).map((c) => c.track_id).filter((id): id is string => !!id)
		])
	];

	const tracksResult = await (trackIds.length
		? admin.from('tracks').select('*').in('id', trackIds)
		: Promise.resolve({ data: [] as { id: string; [key: string]: unknown }[] }));

	const clipMap = new Map((clipsResult.data ?? []).map((c) => [c.id, c]));
	const clipTrackMap = new Map((clipsResult.data ?? []).map((c) => [c.id, c.track_id]));
	const trackMap = new Map((tracksResult.data ?? []).map((t) => [t.id, t as TrackData]));

	// Attempt (per-team timer) — NOT auto-created here
	const attempt = attemptResult.data ?? null;

	// ── Derive field modes & points ───────────────────────────────────────────
	const variant = challenge.variant;
	const pcRaw = (challenge.points_config ?? {}) as Record<string, unknown>;

	let variantDefaultPoints: Record<string, number> = {};
	let tutorialText: string | null = null;
	const { data: vd } = await admin
		.from('variant_defaults')
		.select('points_config, tutorial_text')
		.eq('variant', variant)
		.maybeSingle();
	if (vd) {
		const vdConfig = vd.points_config as Record<string, unknown>;
		variantDefaultPoints = (vdConfig.field_points ?? {}) as Record<string, number>;
		tutorialText = (vd as { tutorial_text?: string | null }).tutorial_text ?? null;
	}

	// Single source of truth for fields + modes + points + bonus flags.
	const resolvedFields = resolveChallengeFields(variant, pcRaw, variantDefaultPoints);
	const {
		fields: variantFields,
		fieldModes,
		fieldPoints,
		bonusFields
	} = fieldMapsFromResolved(resolvedFields);

	// ── Build per-tab view data (audio URLs, source tracks) ──────────────────
	const allTabClipDataLoad: TabClipData[] = tabClips.map((c) => ({
		id: c.id,
		tabId: c.tab_id,
		clipId: c.clip_id,
		fragmentNumber: c.fragment_number,
		sortOrder: c.sort_order,
		trackId: clipTrackMap.get(c.clip_id)
	}));

	const tabList = tabs.map((tab) => {
		const tabClipRows = tabClips
			.filter((c) => c.tab_id === tab.id)
			.sort((a, b) => a.sort_order - b.sort_order);

		const tabEffects = (tab as unknown as { effects?: unknown }).effects as EffectsConfig | null;
		const clipItems = tabClipRows.map((tc) => {
			const clip = clipMap.get(tc.clip_id);
			// storage_path is written as a full public URL by the upload endpoint, so it's
			// used directly. (The old fallback resolved a non-http path against a 'clips'
			// bucket that doesn't exist — canonical audio lives in the 'audio' bucket — so
			// it never produced a working URL and is dropped.)
			const clipUrl = clip?.storage_path ?? '';
			return {
				id: tc.id,
				clipId: tc.clip_id,
				fragmentNumber: tc.fragment_number,
				sortOrder: tc.sort_order,
				clipUrl,
				// Pass full EffectsConfig — Waveform handles all 7 effects.
				// null for non-effects variants so Waveform skips the Web Audio chain.
				effects: challenge.variant === 'effects' ? tabEffects : null
			};
		});

		// Derive source tracks for this tab using the centralised helper
		const resolvedSrcs = getSourceTracksForTab(
			challenge.variant,
			{ id: tab.id, mashup_id: (tab as unknown as { mashup_id?: string | null }).mashup_id },
			sourceTracks as TabSourceTrackRaw[],
			mashupSources,
			allTabClipDataLoad,
			(clipsResult.data ?? []).map((c) => ({ id: c.id, track_id: c.track_id })) as ClipRaw[],
			trackMap
		);

		const sourceTrackItems = resolvedSrcs.map((s) => ({
			id: s.id,
			trackId: s.trackId,
			sortOrder: s.sortOrder
		}));

		return {
			id: tab.id,
			position: tab.position,
			tabIndex: tabs.indexOf(tab),
			clips: clipItems,
			sourceTracks: sourceTrackItems,
			// For mashup tabs the audio comes from the mashup file itself (not a clip).
			// Fall back to first clip URL for all other variants.
			primaryClipUrl:
				clipItems[0]?.clipUrl ||
				(challenge.variant === 'mashup'
					? (mashupAudioUrlMap.get(
							(tab as unknown as { mashup_id?: string | null }).mashup_id ?? ''
						) ?? '')
					: ''),
			primaryClipEffects: clipItems[0]?.effects ?? {}
		};
	});

	// ── Timer ─────────────────────────────────────────────────────────────────
	const timerEndsAt =
		attempt && !attempt.ended_at && (challenge.timer_seconds ?? 0) > 0
			? new Date(attempt.started_at).getTime() + (challenge.timer_seconds ?? 0) * 1000
			: null;

	// ── Combobox pools ────────────────────────────────────────────────────────
	const pools: Record<string, string[]> = {};
	await Promise.all(
		variantFields
			.filter((f) => fieldModes[f] === 'combobox')
			.map(async (f) => {
				const table = FIELD_POOL_TABLE[f as AnswerField];
				if (!table) return;
				const { data } = await admin
					.from(table as never)
					.select('name')
					.order('name');
				pools[f] = ((data as { name: string }[]) ?? []).map((r) => r.name);
			})
	);

	// ── Multiple choice options ───────────────────────────────────────────────
	const { data: answerOptions } = await supabase
		.from('answer_options')
		.select('*')
		.eq('challenge_id', params.id);

	const multipleChoiceOptions: Record<string, string[]> = {};
	for (const f of variantFields) {
		if (fieldModes[f] === 'multiple_choice') {
			multipleChoiceOptions[f] = (answerOptions ?? [])
				.filter((o) => o.field === f && !o.value.startsWith('__'))
				.map((o) => o.value);
		}
	}

	// ── Prior submission ──────────────────────────────────────────────────────
	const { data: existing } = await supabase
		.from('submissions')
		.select('*')
		.eq('challenge_id', params.id)
		.eq('team_id', team.id)
		.maybeSingle();

	let priorResult: ChallengeResult | null = null;

	if (existing) {
		const answersArray = existing.answers as unknown as TabAnswer[];
		const trackDataMap = new Map<string, TrackData>(
			(tracksResult.data ?? []).map((t) => [t.id, t as TrackData])
		);

		// Rebuild result from stored TabAnswer[]
		const tabFieldResults = (Array.isArray(answersArray) ? answersArray : []).map((tabAns, i) => {
			const slotResults = (tabAns.source_answers ?? []).map((sa, j) => {
				const track = sa.matched_source_track_id
					? trackDataMap.get(sa.matched_source_track_id)
					: undefined;
				const fields = track
					? buildFieldResults(
							variantFields.filter((f) => f !== 'grouping') as AnswerField[],
							sa.field_values as Record<string, string>,
							track,
							fieldModes,
							fieldPoints,
							bonusFields
						)
					: [];
				const total = sa.total ?? fields.reduce((s, fr) => s + fr.score, 0);
				const maxTotal =
					fields.reduce((s, fr) => s + fr.maxScore, 0) ||
					variantFields.reduce(
						(s, f) => s + (fieldPoints[f] ?? DEFAULT_FIELD_MAX[f as AnswerField] ?? 10),
						0
					);
				return {
					slotIndex: j,
					matchedTrackId: sa.matched_source_track_id ?? null,
					fields,
					total,
					maxTotal
				};
			});

			const tabTotal = slotResults.reduce((s, sr) => s + sr.total, 0);
			const tabMaxTotal = slotResults.reduce((s, sr) => s + sr.maxTotal, 0);
			return {
				tabPosition: tabAns.tab_position,
				tabIndex: i + 1,
				slots: slotResults,
				total: tabTotal,
				maxTotal: tabMaxTotal
			};
		});

		// Legacy flat tracks list (first slot per tab)
		const legacyTracks = tabFieldResults.map((tr) => ({
			trackId: tr.slots[0]?.matchedTrackId ?? '',
			trackIndex: tr.tabIndex,
			fields: tr.slots[0]?.fields ?? [],
			total: tr.total,
			maxTotal: tr.maxTotal
		}));

		const total = tabFieldResults.reduce((s, tr) => s + tr.total, 0);
		const maxTotal = tabFieldResults.reduce((s, tr) => s + tr.maxTotal, 0);
		const storedBreakdown = Array.isArray(answersArray) ? answersArray[0]?.breakdown : undefined;

		priorResult = {
			total,
			maxTotal,
			tabs: tabFieldResults,
			tracks: legacyTracks,
			status: (existing.status ?? 'auto_wrong') as ChallengeResult['status'],
			submissionId: existing.id,
			isFinal: existing.is_final ?? true,
			breakdown: storedBreakdown
		};
	}

	// ── Hint usage ────────────────────────────────────────────────────────────
	let hintUsed = false;
	if (challenge.hint_text && locals.teamId) {
		const { data: hintRow } = await admin
			.from('challenge_hints_used')
			.select('challenge_id')
			.eq('challenge_id', params.id)
			.eq('team_id', locals.teamId)
			.maybeSingle();
		hintUsed = !!hintRow;
	}

	// ── Active set + NFC lock guard ───────────────────────────────────────────
	let activeSetId: string | null = null;
	let activeSetRecapState: string | null = null;
	if (locals.playerId) {
		const { data: playerRow } = await admin
			.from('players')
			.select('set_id')
			.eq('id', locals.playerId)
			.maybeSingle();
		if (playerRow?.set_id) {
			const { data: gs } = await admin
				.from('game_sets')
				.select('id, recap_state, nfc_lock_enabled')
				.eq('id', playerRow.set_id)
				.maybeSingle();
			if (gs) {
				activeSetId = gs.id;
				activeSetRecapState = gs.recap_state ?? null;

				if (isNfcUnlockRequired(challenge, gs) && locals.teamId) {
					const { data: unlockRow } = await admin
						.from('challenge_unlocks')
						.select('id')
						.eq('challenge_id', params.id)
						.eq('team_id', locals.teamId)
						.eq('set_id', gs.id)
						.maybeSingle();
					if (!unlockRow) redirect(302, '/team');
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
	if (activeSetId && locals.teamId) {
		const { data: hpRows } = await admin
			.from('team_powerups')
			.select(
				'id, powerup_type_id, granted_at, powerup_types(id, name, icon, description, holdable, immediate_use)'
			)
			.eq('team_id', locals.teamId)
			.eq('set_id', activeSetId)
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

	// Teams in this set — the target list for offensive-powerup activation (stuk 1).
	// hasActiveTimedAttempt (stuk 2) lets the picker grey teams a timer attack
	// (freeze/time_drain) can't hit right now; give_a_shot ignores it.
	let setTeams: Array<{
		id: string;
		color: string;
		display_name: string;
		hasActiveTimedAttempt: boolean;
	}> = [];
	if (activeSetId) {
		const teams = await getTeamsInSet(admin, activeSetId);
		const timedTeamIds = await getTeamsWithActiveTimedAttempt(
			admin,
			teams.map((t) => t.id)
		);
		setTeams = teams.map((t) => ({ ...t, hasActiveTimedAttempt: timedTeamIds.has(t.id) }));
	}

	// Active powerup effects + free-answer reveals
	let activeEffects: Awaited<ReturnType<typeof loadActiveEffects>> = [];
	let freeAnswerReveal: Record<string, string> = {};
	if (activeSetId && locals.teamId) {
		activeEffects = await loadActiveEffects(admin, locals.teamId, activeSetId);

		const { data: revealRows } = await admin
			.from('team_effects')
			.select('payload')
			.eq('team_id', locals.teamId)
			.eq('effect_type', 'free_answer')
			.not('consumed_at', 'is', null);
		for (const r of revealRows ?? []) {
			const p = (r.payload ?? {}) as Record<string, unknown>;
			if (
				p.challenge_id === params.id &&
				typeof p.field === 'string' &&
				typeof p.value === 'string'
			) {
				freeAnswerReveal[p.field] = p.value;
			}
		}
	}

	return {
		challenge,
		challengeNotReady,
		tabs: tabList,
		team,
		variantFields,
		fieldModes,
		bonusFields: [...bonusFields],
		pools,
		multipleChoiceOptions,
		fieldPoints,
		timerEndsAt,
		priorResult,
		attempt,
		activeSetId,
		activeSetRecapState,
		showHint,
		hintUsed,
		tutorialText,
		heldPowerups,
		activeEffects,
		freeAnswerReveal,
		setTeams
	};
};

// ─── Actions ──────────────────────────────────────────────────────────────────

export const actions: Actions = {
	submit: async ({ request, params, cookies, locals }) => {
		const supabase = createPublicClient(cookies);
		const admin = createAdminClient();

		const formData = await request.formData();
		const teamId = (formData.get('team_id') as string | null) ?? '';
		if (!teamId) return fail(400, { formError: 'Missing team' });

		// Guard: reject if already submitted
		const { data: existingSub } = await supabase
			.from('submissions')
			.select('id, is_final')
			.eq('challenge_id', params.id)
			.eq('team_id', teamId)
			.maybeSingle();
		if (existingSub) {
			return fail(409, { formError: 'Already submitted — reload to see your result' });
		}

		const [challengeRes, tabsRes] = await Promise.all([
			supabase.from('challenges').select('*').eq('id', params.id).single(),
			supabase.from('challenge_tabs').select('*').eq('challenge_id', params.id).order('position')
		]);
		const challenge = challengeRes.data;
		const tabs = tabsRes.data;
		if (!challenge) return fail(404, { formError: 'Challenge not found' });
		if (!tabs?.length) return fail(500, { formError: 'No tabs configured' });

		// Parse answers_json (new format: Record<tabPosition, SlotDraft[]>)
		const answersJsonRaw = (formData.get('answers_json') as string | null) ?? '{}';
		let draftByTab: Record<string, SlotDraft[]> = {};
		try {
			draftByTab = JSON.parse(answersJsonRaw);
		} catch {
			return fail(400, { formError: 'Invalid answers format' });
		}

		// Resolve the player's set (for effects / crown / powerup earning) and the
		// attempt's elapsed time (for the speed bonus). The rest of the pipeline —
		// scoring, insurance floor, streak, crown, consumeEffects, earning — lives
		// in scoreAndPersistSubmission, shared with the auto-submit backstop.
		let playerSetId: string | null = null;
		if (locals.playerId) {
			const { data: playerRow } = await admin
				.from('players')
				.select('set_id')
				.eq('id', locals.playerId)
				.maybeSingle();
			playerSetId = playerRow?.set_id ?? null;
		}

		const { data: attemptRow } = await admin
			.from('challenge_attempts')
			.select('started_at')
			.eq('challenge_id', params.id)
			.eq('team_id', teamId)
			.maybeSingle();
		const elapsedSeconds = attemptRow?.started_at
			? Math.floor((Date.now() - new Date(attemptRow.started_at).getTime()) / 1000)
			: null;

		const forcePowerupTypeId = import.meta.env.DEV
			? (cookies.get('dev_force_powerup') ?? undefined)
			: undefined;

		const outcome = await scoreAndPersistSubmission(admin, {
			challenge,
			tabs,
			teamId,
			playerSetId,
			draftByTab,
			elapsedSeconds,
			forcePowerupTypeId
		});

		if (!outcome.ok) {
			if (outcome.code === '23505')
				return fail(409, { formError: 'Already submitted — reload to see your result' });
			return fail(500, { formError: outcome.error });
		}

		// One-shot DEV force: consume the cookie once earning has actually run
		// (i.e. the team was in a set). Matches the pre-refactor behavior.
		if (import.meta.env.DEV && forcePowerupTypeId && playerSetId) {
			cookies.delete('dev_force_powerup', { path: '/' });
		}

		const result: ChallengeResult = {
			...outcome.scoredResult,
			submissionId: outcome.submissionId,
			isFinal: true
		};
		return { submitted: true, result, earnedPowerups: outcome.earnedPowerups };
	},

	resolveEarnedPowerup: async ({ request }) => {
		const admin = createAdminClient();
		const fd = await request.formData();
		const teamPowerupId = (fd.get('team_powerup_id') as string | null)?.trim();
		const choice = fd.get('choice') as 'store' | 'lose' | null;
		if (!teamPowerupId || (choice !== 'store' && choice !== 'lose'))
			return fail(400, { error: 'Invalid request' });
		const res = await resolvePowerupChoice(admin, teamPowerupId, choice);
		if (!res.ok) return fail(400, { error: res.error });
		return { resolved: true };
	},

	// "Use now" from the reveal modal (stuk 1.5): fires a holdable-but-targeted
	// powerup (give_a_shot) immediately against a chosen target, straight from its
	// freshly-earned 'pending' status — no Store step first. Distinct from
	// ?/activatePowerup (which requires status='held') so that action's contract
	// stays untouched; this one explicitly allows the pending status and reuses
	// the exact same activatePowerup()/targeting/shield-block path underneath.
	useNowEarnedPowerup: async ({ request, params }) => {
		const admin = createAdminClient();
		const fd = await request.formData();
		const teamPowerupId = (fd.get('team_powerup_id') as string | null)?.trim();
		const targetTeamId = (fd.get('target_team_id') as string | null)?.trim() || undefined;
		if (!teamPowerupId) return fail(400, { activateError: 'Missing powerup ID' });

		const { data: tpu } = await admin
			.from('team_powerups')
			.select('status')
			.eq('id', teamPowerupId)
			.maybeSingle();
		if (!tpu || tpu.status !== 'pending')
			return fail(400, { activateError: 'Powerup is not pending' });

		const result = await activatePowerup(admin, teamPowerupId, {
			currentChallengeId: params.id,
			targetTeamId,
			allowFromPending: true
		});
		if (!result.success) return fail(400, { activateError: result.error });
		return { activated: true, blocked: result.blocked };
	},

	activatePowerup: async ({ request, params }) => {
		const admin = createAdminClient();
		const fd = await request.formData();
		const teamPowerupId = (fd.get('team_powerup_id') as string | null)?.trim();
		const field = (fd.get('field') as string | null)?.trim() || undefined;
		const targetTeamId = (fd.get('target_team_id') as string | null)?.trim() || undefined;
		if (!teamPowerupId) return fail(400, { activateError: 'Missing powerup ID' });
		const result = await activatePowerup(admin, teamPowerupId, {
			currentChallengeId: params.id,
			field,
			targetTeamId
		});
		if (!result.success) return fail(400, { activateError: result.error });
		return { activated: true, revealedValue: result.revealedValue, blocked: result.blocked };
	},

	startChallenge: async ({ params, locals }) => {
		if (!locals.teamId) return fail(401);
		const supabase = createAdminClient();
		const { data: challenge } = await supabase
			.from('challenges')
			.select('id, status')
			.eq('id', params.id)
			.single();
		if (!challenge || challenge.status !== 'active') return fail(400);
		const { error } = await supabase
			.from('challenge_attempts')
			.insert(
				{ challenge_id: params.id, team_id: locals.teamId, started_at: new Date().toISOString() },
				{ onConflict: 'challenge_id,team_id', ignoreDuplicates: true } as never
			);
		if (error) return fail(500, { formError: error.message });
		return { success: true };
	},

	requestReview: async ({ request, cookies }) => {
		const supabase = createPublicClient(cookies);
		const admin = createAdminClient();
		const formData = await request.formData();

		const submissionId = (formData.get('submission_id') as string | null) ?? '';
		const teamId = (formData.get('team_id') as string | null) ?? '';
		const fieldName = (formData.get('field_name') as string | null) ?? '';
		const trackId = (formData.get('track_id') as string | null) || null;
		const playerMessage = (formData.get('player_message') as string | null)?.trim() || null;

		if (!submissionId || !teamId || !fieldName)
			return fail(400, { reviewError: 'Missing required fields' });

		const { data: sub } = await supabase
			.from('submissions')
			.select('id, team_id, status')
			.eq('id', submissionId)
			.eq('team_id', teamId)
			.single();

		if (!sub) return fail(403, { reviewError: 'Submission not found' });
		if (sub.status === 'review_approved') return fail(400, { reviewError: 'Already approved' });

		const { data: existing } = await admin
			.from('review_requests')
			.select('id')
			.eq('submission_id', submissionId)
			.eq('field_name', fieldName)
			.eq('resolved', false)
			.maybeSingle();

		if (existing) return fail(409, { reviewError: 'Review already requested for this field' });

		const { error: rrErr } = await admin.from('review_requests').insert({
			submission_id: submissionId,
			field_name: fieldName,
			track_id: trackId,
			player_message: playerMessage
		});
		if (rrErr) return fail(500, { reviewError: rrErr.message });

		await admin.from('submissions').update({ status: 'review_requested' }).eq('id', submissionId);

		return { reviewRequested: true, reviewedField: fieldName };
	}
};
