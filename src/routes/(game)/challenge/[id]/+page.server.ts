import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';
import type { AnswerField, InputMode, ChallengeResult, AnswerArrayEntry } from '$lib/types/index.js';
import {
	VARIANT_FIELDS,
	DEFAULT_INPUT_MODES,
	FIELD_POOL_TABLE,
	DEFAULT_FIELD_MAX,
	buildFieldResults,
	scoreSubmission,
	type TrackData,
	type BonusParams
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

	// Fetch all tracks for this challenge (multi-track support)
	const { data: challengeTracks, error: ctErr } = await supabase
		.from('challenge_tracks')
		.select('*')
		.eq('challenge_id', params.id)
		.order('sort_order');

	if (ctErr || !challengeTracks?.length) error(500, 'Challenge has no tracks configured');

	const trackIds = challengeTracks.map((ct) => ct.track_id);
	const clipIds = challengeTracks.map((ct) => ct.clip_id);

	const [tracksResult, clipsResult, teamResult, attemptResult] = await Promise.all([
		admin.from('tracks').select('*').in('id', trackIds),
		supabase.from('clips').select('*').in('id', clipIds),
		supabase.from('teams').select('*').eq('id', locals.teamId).single(),
		admin
			.from('challenge_attempts')
			.select('*')
			.eq('challenge_id', params.id)
			.eq('team_id', locals.teamId)
			.maybeSingle()
	]);

	if (!tracksResult.data?.length || !clipsResult.data?.length) error(500, 'Track or clip data missing');
	if (!teamResult.data) redirect(302, '/join');

	const team = teamResult.data;

	// ── Attempt (per-team timer) ──────────────────────────────────────────────
	let attempt = attemptResult.data;
	if (!attempt && challenge.status === 'active') {
		const { data: newAttempt } = await admin
			.from('challenge_attempts')
			.insert({ challenge_id: params.id, team_id: team.id })
			.select()
			.single();
		attempt = newAttempt;
	}
	const trackMap = new Map(tracksResult.data.map((t) => [t.id, t]));
	const clipMap = new Map(clipsResult.data.map((c) => [c.id, c]));

	// ── Derive field modes & points ───────────────────────────────────────────
	const variant = challenge.variant;
	const variantFields: AnswerField[] = VARIANT_FIELDS[variant] ?? ['artist', 'title', 'year'];

	const pcRaw = (challenge.points_config ?? {}) as Record<string, unknown>;
	const savedModes = (pcRaw.field_modes ?? {}) as Record<string, string>;

	// Three-tier field points: challenge override > variant_defaults > hardcoded
	let variantDefaultPoints: Record<string, number> = {};
	let tutorialText: string | null = null;
	const { data: vd } = await admin.from('variant_defaults').select('points_config, tutorial_text').eq('variant', variant).maybeSingle();
	if (vd) {
		const vdConfig = vd.points_config as Record<string, unknown>;
		variantDefaultPoints = (vdConfig.field_points ?? {}) as Record<string, number>;
		tutorialText = (vd as { tutorial_text?: string | null }).tutorial_text ?? null;
	}

	const challengeFieldPoints = (pcRaw.field_points ?? {}) as Record<string, number>;
	const fieldPoints: Record<string, number> = {};
	for (const f of variantFields) {
		fieldPoints[f] = challengeFieldPoints[f] ?? variantDefaultPoints[f] ?? DEFAULT_FIELD_MAX[f as AnswerField] ?? 5;
	}

	const fieldModes: Record<string, InputMode> = {};
	for (const f of variantFields) {
		fieldModes[f] = (savedModes[f] as InputMode) ?? DEFAULT_INPUT_MODES[variant]?.[f as AnswerField] ?? 'open_text';
	}

	// ── Clip URLs ─────────────────────────────────────────────────────────────
	const trackList = challengeTracks.map((ct) => {
		const clip = clipMap.get(ct.clip_id)!;
		const clipUrl = clip.storage_path.startsWith('http')
			? clip.storage_path
			: supabase.storage.from('clips').getPublicUrl(clip.storage_path).data.publicUrl;
		const effects = (clip.effects as { pitch?: number; tempo?: number } | null) ?? {};
		return { id: ct.id, trackId: ct.track_id, sortOrder: ct.sort_order, clipUrl, effects };
	});

	// ── Timer (based on team's own attempt start time) ───────────────────────
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
				const { data } = await admin.from(table as never).select('name').order('name');
				pools[f] = (data as { name: string }[] ?? []).map((r) => r.name);
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
		const answersArray = existing.answers as unknown as AnswerArrayEntry[];
		const trackDataMap = new Map<string, TrackData>(
			tracksResult.data.map((t) => [t.id, t as TrackData])
		);

		const tracks = (Array.isArray(answersArray) ? answersArray : []).map((entry, i) => {
			const track = entry.track_id ? trackDataMap.get(entry.track_id) : undefined;
			const fields = track
				? buildFieldResults(variantFields, entry.field_values ?? {}, track, fieldModes, fieldPoints)
				: [];
			const total = entry.total ?? fields.reduce((s, fr) => s + fr.score, 0);
			const maxTotal = fields.reduce((s, fr) => s + fr.maxScore, 0) ||
				variantFields.reduce((s, f) => s + (fieldPoints[f] ?? DEFAULT_FIELD_MAX[f as AnswerField] ?? 5), 0);
			return { trackId: entry.track_id ?? '', trackIndex: i + 1, fields, total, maxTotal };
		});

		const total = tracks.reduce((s, tr) => s + tr.total, 0);
		const maxTotal = tracks.reduce((s, tr) => s + tr.maxTotal, 0);

		// Restore breakdown from stored answers if available
		const storedBreakdown = Array.isArray(answersArray) ? answersArray[0]?.breakdown : undefined;

		priorResult = {
			total,
			maxTotal,
			tracks,
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

	// Check if player is in a set with an active recap (for redirect)
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
				.select('id, recap_state')
				.eq('id', playerRow.set_id)
				.maybeSingle();
			if (gs) {
				activeSetId = gs.id;
				activeSetRecapState = gs.recap_state ?? null;
			}
		}
	}

	return {
		challenge,
		challengeTracks: trackList,
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

		// Guard: reject if already submitted (is_final check)
		const { data: existingSub } = await supabase
			.from('submissions')
			.select('id, is_final')
			.eq('challenge_id', params.id)
			.eq('team_id', teamId)
			.maybeSingle();

		if (existingSub) {
			return fail(409, { formError: 'Already submitted — reload to see your result' });
		}

		const [challengeRes, challengeTracksRes] = await Promise.all([
			supabase.from('challenges').select('*').eq('id', params.id).single(),
			supabase.from('challenge_tracks').select('id, track_id, sort_order').eq('challenge_id', params.id).order('sort_order')
		]);
		const challenge = challengeRes.data;
		const challengeTracks = challengeTracksRes.data;
		if (!challenge) return fail(404, { formError: 'Challenge not found' });
		if (!challengeTracks?.length) return fail(500, { formError: 'Challenge track not found' });

		const trackIds = challengeTracks.map((ct) => ct.track_id);
		const { data: tracks } = await admin.from('tracks').select('*').in('id', trackIds);
		if (!tracks?.length) return fail(500, { formError: 'Track not found' });

		const variant = challenge.variant;
		const variantFields: AnswerField[] = VARIANT_FIELDS[variant] ?? ['artist', 'title', 'year'];

		const pcRaw = (challenge.points_config ?? {}) as Record<string, unknown>;
		const savedModes = (pcRaw.field_modes ?? {}) as Record<string, string>;
		const fieldModes: Record<string, InputMode> = {};
		for (const f of variantFields) {
			fieldModes[f] = (savedModes[f] as InputMode) ?? DEFAULT_INPUT_MODES[variant]?.[f as AnswerField] ?? 'open_text';
		}

		const { data: vdRow } = await admin.from('variant_defaults').select('points_config, streak_config').eq('variant', variant).maybeSingle();
		const variantDefaultPoints = ((vdRow?.points_config as Record<string, unknown> | null)?.field_points ?? {}) as Record<string, number>;
		const streakThresholds = ((vdRow?.streak_config as Record<string, unknown> | null)?.thresholds ?? []) as Array<{ streak: number; bonus: number }>;

		const challengeFieldPoints = (pcRaw.field_points ?? {}) as Record<string, number>;
		const fieldPoints: Record<string, number> = {};
		for (const f of variantFields) {
			fieldPoints[f] = challengeFieldPoints[f] ?? variantDefaultPoints[f] ?? DEFAULT_FIELD_MAX[f as AnswerField] ?? 5;
		}

		// Parse answers_json from form (set directly on FormData by use:enhance callback)
		const answersJsonRaw = (formData.get('answers_json') as string | null) ?? '{}';
		let draftByTrack: Record<string, Record<string, string>> = {};
		try {
			draftByTrack = JSON.parse(answersJsonRaw);
		} catch {
			return fail(400, { formError: 'Invalid answers format' });
		}

		// ── Bonus params ─────────────────────────────────────────────────────────
		// Fetch team (for score + streak), all teams (for leader score), player's
		// set (for challenge_multiplier), and attempt (for elapsed seconds) in parallel.
		const [teamRes, allTeamsRes, attemptRes] = await Promise.all([
			admin.from('teams').select('score, current_streak').eq('id', teamId).single(),
			admin.from('teams').select('score').order('score', { ascending: false }).limit(1),
			admin.from('challenge_attempts').select('started_at').eq('challenge_id', params.id).eq('team_id', teamId).maybeSingle()
		]);

		const teamRow = teamRes.data;
		const leaderScore = allTeamsRes.data?.[0]?.score ?? 0;
		const attemptStartedAt = attemptRes.data?.started_at ?? null;
		const elapsedSeconds = attemptStartedAt
			? Math.floor((Date.now() - new Date(attemptStartedAt).getTime()) / 1000)
			: null;

		// challenge_multiplier: look up set_challenges for the player's active set
		let challengeMultiplier = 1;
		if (locals.playerId) {
			const { data: playerRow } = await admin.from('players').select('set_id').eq('id', locals.playerId).maybeSingle();
			if (playerRow?.set_id) {
				const { data: sc } = await admin
					.from('set_challenges')
					.select('challenge_multiplier')
					.eq('challenge_id', params.id)
					.eq('set_id', playerRow.set_id)
					.maybeSingle();
				challengeMultiplier = (sc as { challenge_multiplier?: number } | null)?.challenge_multiplier ?? 1;
			}
		}

		const bonusParams: BonusParams = {
			difficulty_rating: (challenge as unknown as { difficulty_rating?: number }).difficulty_rating ?? 3,
			challenge_multiplier: challengeMultiplier,
			team_score: teamRow?.score ?? 0,
			leader_score: leaderScore,
			current_streak: teamRow?.current_streak ?? 0,
			streak_thresholds: streakThresholds,
			elapsed_seconds: elapsedSeconds,
			speed_threshold_seconds: (challenge as unknown as { speed_threshold_seconds?: number | null }).speed_threshold_seconds ?? null
		};

		const trackDataMap = new Map<string, TrackData>(tracks.map((t) => [t.id, t as TrackData]));
		const ctList = challengeTracks.map((ct) => ({ id: ct.id, trackId: ct.track_id }));

		const { answersArray, result: scoredResult } = scoreSubmission(
			draftByTrack, ctList, trackDataMap, variantFields, fieldModes, fieldPoints, bonusParams
		);

		const finalScore = scoredResult.breakdown?.final ?? scoredResult.total;

		const { data: sub, error: subErr } = await supabase.from('submissions').insert({
			challenge_id: params.id,
			team_id: teamId,
			answers: answersArray as never,
			score: finalScore,
			is_final: true
		}).select('id').single();

		if (subErr) {
			if (subErr.code === '23505') return fail(409, { formError: 'Already submitted — reload to see your result' });
			return fail(500, { formError: subErr.message });
		}
		if (!sub) return fail(500, { formError: 'Submission insert returned no data' });

		// Update streak: increment if any base score, else reset
		const newStreak = scoredResult.total > 0 ? (teamRow?.current_streak ?? 0) + 1 : 0;

		await Promise.all([
			admin.from('submissions').update({ status: scoredResult.status } as never).eq('id', sub.id),
			admin.from('challenge_attempts').update({ ended_at: new Date().toISOString() }).eq('challenge_id', params.id).eq('team_id', teamId),
			admin.from('teams').update({ score: (teamRow?.score ?? 0) + finalScore, current_streak: newStreak }).eq('id', teamId)
		]);

		const result: ChallengeResult = {
			...scoredResult,
			submissionId: sub.id,
			isFinal: true
		};
		return { submitted: true, result };
	},

	requestReview: async ({ request, params, cookies }) => {
		const supabase = createPublicClient(cookies);
		const admin = createAdminClient();
		const formData = await request.formData();

		const submissionId = (formData.get('submission_id') as string | null) ?? '';
		const teamId = (formData.get('team_id') as string | null) ?? '';
		const fieldName = (formData.get('field_name') as string | null) ?? '';
		const trackId = (formData.get('track_id') as string | null) || null;
		const playerMessage = (formData.get('player_message') as string | null)?.trim() || null;

		if (!submissionId || !teamId || !fieldName) {
			return fail(400, { reviewError: 'Missing required fields' });
		}

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
