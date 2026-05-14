import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';
import { isNfcUnlockRequired } from '$lib/server/nfc';
import type {
	AnswerField,
	InputMode,
	ChallengeResult,
	TabAnswer,
	EffectsConfig
} from '$lib/types/index.js';
import {
	TYPE_FIELDS,
	VARIANT_FIELDS,
	DEFAULT_INPUT_MODES,
	FIELD_POOL_TABLE,
	DEFAULT_FIELD_MAX,
	buildFieldResults,
	scoreSubmission,
	getSourceTracksForTab,
	type TrackData,
	type BonusParams,
	type TabInput,
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
	const { data: tabs, error: tabErr } = await supabase
		.from('challenge_tabs')
		.select('*')
		.eq('challenge_id', params.id)
		.order('position');

	if (tabErr || !tabs?.length) error(500, 'Challenge has no tabs configured');

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

	// For mashup variant: load mashup sources to derive per-tab source tracks
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
	const { data: mashupSourceRows } = mashupIds.length
		? await admin.from('mashup_sources').select('*').in('mashup_id', mashupIds).order('sort_order')
		: { data: [] };
	const mashupSources: MashupSourceRaw[] = (mashupSourceRows ?? []).map((r) => ({
		id: r.id,
		mashup_id: r.mashup_id,
		track_id: r.track_id,
		sort_order: r.sort_order
	}));

	// Collect all referenced track IDs (including mashup sources)
	const clipIds = [...new Set(tabClips.map((c) => c.clip_id))];
	const trackIds = [
		...new Set([...sourceTracks.map((s) => s.track_id), ...mashupSources.map((s) => s.track_id)])
	];

	const [tracksResult, clipsResult] = await Promise.all([
		trackIds.length
			? admin.from('tracks').select('*').in('id', trackIds)
			: Promise.resolve({ data: [] }),
		clipIds.length
			? supabase.from('clips').select('id, track_id, storage_path, type, effects').in('id', clipIds)
			: Promise.resolve({ data: [] })
	]);

	const clipMap = new Map((clipsResult.data ?? []).map((c) => [c.id, c]));
	const clipTrackMap = new Map((clipsResult.data ?? []).map((c) => [c.id, c.track_id]));
	const trackMap = new Map((tracksResult.data ?? []).map((t) => [t.id, t as TrackData]));

	// Attempt (per-team timer) — NOT auto-created here
	const attempt = attemptResult.data ?? null;

	// ── Derive field modes & points ───────────────────────────────────────────
	const variant = challenge.variant;
	const variantFields: AnswerField[] = (TYPE_FIELDS[variant] ??
		VARIANT_FIELDS[variant] ?? ['artist', 'title', 'year']) as AnswerField[];

	const pcRaw = (challenge.points_config ?? {}) as Record<string, unknown>;
	const savedModes = (pcRaw.field_modes ?? {}) as Record<string, string>;

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

	const challengeFieldPoints = (pcRaw.field_points ?? {}) as Record<string, number>;
	const fieldPoints: Record<string, number> = {};
	for (const f of variantFields) {
		fieldPoints[f] =
			challengeFieldPoints[f] ??
			variantDefaultPoints[f] ??
			DEFAULT_FIELD_MAX[f as AnswerField] ??
			10;
	}

	const fieldModes: Record<string, InputMode> = {};
	for (const f of variantFields) {
		fieldModes[f] =
			(savedModes[f] as InputMode) ??
			DEFAULT_INPUT_MODES[variant]?.[f as AnswerField] ??
			'open_text';
	}

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
			const clipUrl = clip
				? clip.storage_path.startsWith('http')
					? clip.storage_path
					: supabase.storage.from('clips').getPublicUrl(clip.storage_path).data.publicUrl
				: '';
			// For effects variant: use tab-level effects; otherwise use clip-level effects
			const effects =
				challenge.variant === 'effects'
					? {
							pitch: tabEffects?.pitch?.enabled ? tabEffects.pitch.semitones : 0,
							tempo: tabEffects?.tempo?.enabled ? tabEffects.tempo.rate : 1
						}
					: ((clip?.effects as { pitch?: number; tempo?: number } | null) ?? {});
			return {
				id: tc.id,
				clipId: tc.clip_id,
				fragmentNumber: tc.fragment_number,
				sortOrder: tc.sort_order,
				clipUrl,
				effects,
				tabEffects: challenge.variant === 'effects' ? tabEffects : undefined
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
			// Primary clip for simple single-source tabs (first clip)
			primaryClipUrl: clipItems[0]?.clipUrl ?? '',
			primaryClipEffects: clipItems[0]?.effects ?? {}
		};
	});

	// ── Timer ─────────────────────────────────────────────────────────────────
	const timerEndsAt =
		attempt && !attempt.ended_at && (challenge.timer_seconds ?? 0) > 0
			? new Date(attempt.started_at).getTime() + challenge.timer_seconds * 1000
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
							fieldPoints
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

	return {
		challenge,
		tabs: tabList,
		team,
		variantFields,
		fieldModes,
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
		tutorialText
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

		const tabIds = tabs.map((t) => t.id);
		const variant = challenge.variant;

		const [sourceTracksResult, tabClipsResult] = await Promise.all([
			admin
				.from('challenge_tab_source_tracks')
				.select('*')
				.in('tab_id', tabIds)
				.order('sort_order'),
			admin.from('challenge_tab_clips').select('*').in('tab_id', tabIds).order('sort_order')
		]);
		const sourceTracks = sourceTracksResult.data ?? [];
		const tabClipRows = tabClipsResult.data ?? [];

		// For mashup: load mashup sources
		const mashupIds =
			variant === 'mashup'
				? [
						...new Set(
							tabs
								.map((t) => (t as unknown as { mashup_id?: string | null }).mashup_id)
								.filter((id): id is string => !!id)
						)
					]
				: [];
		const { data: mashupSourceRows } = mashupIds.length
			? await admin
					.from('mashup_sources')
					.select('*')
					.in('mashup_id', mashupIds)
					.order('sort_order')
			: { data: [] };
		const submitMashupSources: MashupSourceRaw[] = (mashupSourceRows ?? []).map((r) => ({
			id: r.id,
			mashup_id: r.mashup_id,
			track_id: r.track_id,
			sort_order: r.sort_order
		}));

		const clipIds = [...new Set(tabClipRows.map((c) => c.clip_id))];
		const trackIds = [
			...new Set([
				...sourceTracks.map((s) => s.track_id),
				...submitMashupSources.map((s) => s.track_id)
			])
		];

		const [tracksResult, clipsResult] = await Promise.all([
			trackIds.length
				? admin.from('tracks').select('*').in('id', trackIds)
				: Promise.resolve({ data: [] }),
			clipIds.length
				? admin.from('clips').select('id, track_id').in('id', clipIds)
				: Promise.resolve({ data: [] })
		]);
		const trackMap = new Map((tracksResult.data ?? []).map((t) => [t.id, t as TrackData]));
		const submitClips: ClipRaw[] = (clipsResult.data ?? []).map((c) => ({
			id: c.id,
			track_id: c.track_id
		}));
		const allTabClipData: TabClipData[] = tabClipRows.map((c) => ({
			id: c.id,
			tabId: c.tab_id,
			clipId: c.clip_id,
			fragmentNumber: c.fragment_number,
			sortOrder: c.sort_order,
			trackId: submitClips.find((cl) => cl.id === c.clip_id)?.track_id
		}));

		const variantFields = (TYPE_FIELDS[variant] ?? ['artist', 'title', 'year']) as AnswerField[];

		const pcRaw = (challenge.points_config ?? {}) as Record<string, unknown>;
		const savedModes = (pcRaw.field_modes ?? {}) as Record<string, string>;
		const fieldModes: Record<string, InputMode> = {};
		for (const f of variantFields) {
			fieldModes[f] =
				(savedModes[f] as InputMode) ??
				DEFAULT_INPUT_MODES[variant]?.[f as AnswerField] ??
				'open_text';
		}

		const { data: vdRow } = await admin
			.from('variant_defaults')
			.select('points_config, streak_config')
			.eq('variant', variant)
			.maybeSingle();
		const variantDefaultPoints = ((vdRow?.points_config as Record<string, unknown> | null)
			?.field_points ?? {}) as Record<string, number>;
		const streakThresholds = ((vdRow?.streak_config as Record<string, unknown> | null)
			?.thresholds ?? []) as Array<{ streak: number; bonus: number }>;

		const challengeFieldPoints = (pcRaw.field_points ?? {}) as Record<string, number>;
		const fieldPoints: Record<string, number> = {};
		for (const f of variantFields) {
			fieldPoints[f] =
				challengeFieldPoints[f] ??
				variantDefaultPoints[f] ??
				DEFAULT_FIELD_MAX[f as AnswerField] ??
				10;
		}

		// Parse answers_json (new format: Record<tabPosition, SlotDraft[]>)
		const answersJsonRaw = (formData.get('answers_json') as string | null) ?? '{}';
		let draftByTab: Record<string, SlotDraft[]> = {};
		try {
			draftByTab = JSON.parse(answersJsonRaw);
		} catch {
			return fail(400, { formError: 'Invalid answers format' });
		}

		// ── Bonus params ──────────────────────────────────────────────────────
		const [teamRes, allTeamsRes, attemptRes] = await Promise.all([
			admin.from('teams').select('score, current_streak').eq('id', teamId).single(),
			admin.from('teams').select('score').order('score', { ascending: false }).limit(1),
			admin
				.from('challenge_attempts')
				.select('started_at')
				.eq('challenge_id', params.id)
				.eq('team_id', teamId)
				.maybeSingle()
		]);

		const teamRow = teamRes.data;
		const leaderScore = allTeamsRes.data?.[0]?.score ?? 0;
		const attemptStartedAt = attemptRes.data?.started_at ?? null;
		const elapsedSeconds = attemptStartedAt
			? Math.floor((Date.now() - new Date(attemptStartedAt).getTime()) / 1000)
			: null;

		let challengeMultiplier = 1;
		if (locals.playerId) {
			const { data: playerRow } = await admin
				.from('players')
				.select('set_id')
				.eq('id', locals.playerId)
				.maybeSingle();
			if (playerRow?.set_id) {
				const { data: sc } = await admin
					.from('set_challenges')
					.select('challenge_multiplier')
					.eq('challenge_id', params.id)
					.eq('set_id', playerRow.set_id)
					.maybeSingle();
				challengeMultiplier =
					(sc as { challenge_multiplier?: number } | null)?.challenge_multiplier ?? 1;
			}
		}

		const bonusParams: BonusParams = {
			difficulty_rating:
				(challenge as unknown as { difficulty_rating?: number }).difficulty_rating ?? 3,
			challenge_multiplier: challengeMultiplier,
			team_score: teamRow?.score ?? 0,
			leader_score: leaderScore,
			current_streak: teamRow?.current_streak ?? 0,
			streak_thresholds: streakThresholds,
			elapsed_seconds: elapsedSeconds,
			speed_threshold_seconds:
				(challenge as unknown as { speed_threshold_seconds?: number | null })
					.speed_threshold_seconds ?? null
		};

		// Build TabInput[] for scoreSubmission using getSourceTracksForTab
		const tabInputs: TabInput[] = tabs.map((tab) => {
			const tabSrcs = getSourceTracksForTab(
				variant,
				{ id: tab.id, mashup_id: (tab as unknown as { mashup_id?: string | null }).mashup_id },
				sourceTracks as TabSourceTrackRaw[],
				submitMashupSources,
				allTabClipData,
				submitClips,
				trackMap
			);

			const tabClipItems = allTabClipData.filter((c) => c.tabId === tab.id);
			const playerDraft: SlotDraft[] = draftByTab[String(tab.position)] ?? [{ fieldValues: {} }];

			return {
				tabId: tab.id,
				tabPosition: tab.position,
				sourceTracks: tabSrcs,
				clips: tabClipItems,
				playerDraft
			};
		});

		const { answersArray, result: scoredResult } = scoreSubmission(
			tabInputs,
			variantFields,
			fieldModes,
			fieldPoints,
			bonusParams
		);

		const finalScore = scoredResult.breakdown?.final ?? scoredResult.total;

		const { data: sub, error: subErr } = await supabase
			.from('submissions')
			.insert({
				challenge_id: params.id,
				team_id: teamId,
				answers: answersArray as never,
				score: finalScore,
				is_final: true
			})
			.select('id')
			.single();

		if (subErr) {
			if (subErr.code === '23505')
				return fail(409, { formError: 'Already submitted — reload to see your result' });
			return fail(500, { formError: subErr.message });
		}
		if (!sub) return fail(500, { formError: 'Submission insert returned no data' });

		const newStreak = scoredResult.total > 0 ? (teamRow?.current_streak ?? 0) + 1 : 0;

		await Promise.all([
			admin
				.from('submissions')
				.update({ status: scoredResult.status } as never)
				.eq('id', sub.id),
			admin
				.from('challenge_attempts')
				.update({ ended_at: new Date().toISOString() })
				.eq('challenge_id', params.id)
				.eq('team_id', teamId),
			admin
				.from('teams')
				.update({ score: (teamRow?.score ?? 0) + finalScore, current_streak: newStreak })
				.eq('id', teamId)
		]);

		const result: ChallengeResult = { ...scoredResult, submissionId: sub.id, isFinal: true };
		return { submitted: true, result };
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
