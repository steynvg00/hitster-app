import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';
import type { AnswerField, InputMode, FieldResult, ChallengeResult, SubmissionStatus } from '$lib/types/index.js';

// ─── Scoring constants ────────────────────────────────────────────────────────

const VARIANT_FIELDS: Record<string, AnswerField[]> = {
	normal:    ['artist', 'title', 'year'],
	label:     ['label', 'artist', 'title', 'year'],
	anthem:    ['festival', 'artist', 'title', 'year'],
	vocal:     ['vocal_source', 'artist', 'year'],
	fragments: ['title', 'artist'],
	kick:      ['artist'],
	mashup:    ['artist', 'title'],
	battle:    ['artist', 'title', 'year']
};

// Default field input modes per variant — used when host hasn't explicitly set one.
// Stored in challenge.points_config.field_modes when overridden.
const DEFAULT_INPUT_MODES: Record<string, Partial<Record<AnswerField, InputMode>>> = {
	normal:    { artist: 'combobox', title: 'open_text', year: 'slider' },
	label:     { label: 'combobox', artist: 'combobox', title: 'open_text', year: 'slider' },
	anthem:    { festival: 'combobox', artist: 'combobox', title: 'open_text', year: 'slider' },
	vocal:     { vocal_source: 'combobox', artist: 'combobox', year: 'slider' },
	fragments: { title: 'open_text', artist: 'combobox' },
	kick:      { artist: 'multiple_choice' },
	mashup:    { artist: 'combobox', title: 'open_text' },
	battle:    { artist: 'combobox', title: 'open_text', year: 'slider' }
};

// Which pool table backs each combobox field
const FIELD_POOL_TABLE: Partial<Record<AnswerField, string>> = {
	artist:       'answer_pool_artists',
	label:        'answer_pool_labels',
	festival:     'answer_pool_festivals',
	vocal_source: 'answer_pool_vocal_sources'
};

// Default max points per field (overridden by challenge.points_config)
const DEFAULT_FIELD_MAX: Partial<Record<AnswerField, number>> = {
	artist: 5, title: 5, year: 10, label: 5, festival: 5, vocal_source: 5
};

// ─── Fuzzy matching (Levenshtein) ─────────────────────────────────────────────

function editDistance(a: string, b: string): number {
	const m = a.length, n = b.length;
	const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
	for (let i = 1; i <= m; i++) {
		let prev = i;
		for (let j = 1; j <= n; j++) {
			const curr = a[i - 1] === b[j - 1] ? dp[j - 1] : 1 + Math.min(dp[j - 1], dp[j], prev);
			dp[j - 1] = prev;
			prev = curr;
		}
		dp[n] = prev;
	}
	return dp[n];
}

function strSimilarity(a: string, b: string): number {
	const s1 = a.toLowerCase().trim();
	const s2 = b.toLowerCase().trim();
	if (s1 === s2) return 1;
	const maxLen = Math.max(s1.length, s2.length);
	if (maxLen === 0) return 1;
	return (maxLen - editDistance(s1, s2)) / maxLen;
}

// ─── Per-field scoring ────────────────────────────────────────────────────────

type TrackData = {
	artist: string; title: string; year: number;
	record_label?: string | null; festival?: string | null;
	vocal_source?: string | null;
	accepted_titles?: string[] | null;
};

function scoreField(
	field: AnswerField,
	submitted: string,
	track: TrackData,
	mode: InputMode,
	maxPoints: number
): { score: number; fuzzyScore?: number } {
	if (field === 'year') {
		const diff = Math.abs(parseInt(submitted, 10) - track.year);
		if (diff === 0) return { score: maxPoints };
		if (diff === 1) return { score: Math.round(maxPoints * 0.5) };
		if (diff === 2) return { score: Math.round(maxPoints * 0.2) };
		return { score: 0 };
	}

	const trackValue = String(track[field === 'label' ? 'record_label' : field as keyof TrackData] ?? '');

	if (mode === 'open_text') {
		// For title: fuzzy match against accepted_titles (includes canonical title)
		const targets = field === 'title'
			? (track.accepted_titles?.length ? track.accepted_titles : [track.title])
			: [trackValue];
		const bestSim = Math.max(...targets.map((t) => strSimilarity(submitted, t)));
		return { score: bestSim >= 0.9 ? maxPoints : 0, fuzzyScore: bestSim };
	}

	// combobox / multiple_choice / typeable_number: exact match (case-insensitive)
	const correct = submitted.trim().toLowerCase() === trackValue.trim().toLowerCase();
	return { score: correct ? maxPoints : 0 };
}

function buildFieldResults(
	variantFields: AnswerField[],
	answers: Record<string, string>,
	track: TrackData,
	fieldModes: Record<string, InputMode>,
	pointsConfig: Record<string, number>
): FieldResult[] {
	return variantFields.map((field) => {
		const submitted = answers[field] ?? '';
		const mode = fieldModes[field] ?? 'open_text';
		const maxScore = pointsConfig[field] ?? DEFAULT_FIELD_MAX[field] ?? 5;
		const { score, fuzzyScore } = scoreField(field, submitted, track, mode, maxScore);
		const correct = field === 'year'
			? String(track.year)
			: String(track[field === 'label' ? 'record_label' : field as keyof TrackData] ?? '');
		return { field, submitted, correct, score, maxScore, fuzzyScore };
	});
}

// ─── Load ────────────────────────────────────────────────────────────────────

export const load: PageServerLoad = async ({ params, cookies, locals }) => {
	if (!locals.teamId) redirect(302, `/join?redirect=/challenge/${params.id}`);

	const supabase = createPublicClient(cookies);
	const admin = createAdminClient();

	const { data: challenge, error: challengeErr } = await supabase
		.from('challenges')
		.select('*')
		.eq('id', params.id)
		.single();

	if (challengeErr || !challenge) error(404, 'Challenge not found');

	const { data: challengeTrack, error: ctErr } = await supabase
		.from('challenge_tracks')
		.select('*')
		.eq('challenge_id', params.id)
		.order('sort_order')
		.limit(1)
		.single();

	if (ctErr || !challengeTrack) error(500, 'Challenge has no tracks configured');

	const [trackResult, clipResult] = await Promise.all([
		supabase.from('tracks').select('*').eq('id', challengeTrack.track_id).single(),
		supabase.from('clips').select('*').eq('id', challengeTrack.clip_id).single()
	]);

	if (!trackResult.data || !clipResult.data) error(500, 'Track or clip data missing');

	const track = trackResult.data;
	const clip = clipResult.data;

	const clipUrl = clip.storage_path.startsWith('http')
		? clip.storage_path
		: supabase.storage.from('clips').getPublicUrl(clip.storage_path).data.publicUrl;

	const { data: team } = await supabase.from('teams').select('*').eq('id', locals.teamId).single();
	if (!team) redirect(302, '/join');

	// ── Derive field modes ────────────────────────────────────────────────────
	const variant = challenge.variant;
	const variantFields: AnswerField[] = VARIANT_FIELDS[variant] ?? ['artist', 'title', 'year'];

	// Read host-configured overrides from points_config.field_modes
	const pcRaw = (challenge.points_config ?? {}) as Record<string, unknown>;
	const savedModes = (pcRaw.field_modes ?? {}) as Record<string, string>;
	const fieldModes: Record<string, InputMode> = {};
	for (const f of variantFields) {
		fieldModes[f] = (savedModes[f] as InputMode) ?? DEFAULT_INPUT_MODES[variant]?.[f] ?? 'open_text';
	}

	const pointsConfig = (pcRaw.field_points ?? {}) as Record<string, number>;

	// ── Load combobox pools (server-side; not exposed as correct answers) ──────
	const pools: Record<string, string[]> = {};
	await Promise.all(
		variantFields
			.filter((f) => fieldModes[f] === 'combobox')
			.map(async (f) => {
				const table = FIELD_POOL_TABLE[f];
				if (!table) return;
				const { data } = await admin.from(table as never).select('name').order('name');
				pools[f] = (data as { name: string }[] ?? []).map((r) => r.name);
			})
	);

	// ── Load multiple_choice options ──────────────────────────────────────────
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

	// ── Check for prior submission ────────────────────────────────────────────
	const { data: existing } = await supabase
		.from('submissions')
		.select('*')
		.eq('challenge_id', params.id)
		.eq('team_id', team.id)
		.maybeSingle();

	let priorResult: ChallengeResult | null = null;

	if (existing) {
		const ans = existing.answers as Record<string, string>;
		const fields = buildFieldResults(variantFields, ans, track, fieldModes, pointsConfig);
		const maxTotal = fields.reduce((s, f) => s + f.maxScore, 0);
		priorResult = {
			total: existing.score ?? 0,
			maxTotal,
			fields,
			status: (existing.status ?? 'auto_wrong') as SubmissionStatus,
			submissionId: existing.id
		};
	}

	return {
		challenge,
		track: { id: track.id, year: track.year }, // don't leak title/artist before submission
		clipUrl,
		team,
		variantFields,
		fieldModes,
		pools,
		multipleChoiceOptions,
		pointsConfig,
		priorResult
	};
};

// ─── Actions ──────────────────────────────────────────────────────────────────

export const actions: Actions = {
	submit: async ({ request, params, cookies }) => {
		const supabase = createPublicClient(cookies);
		const admin = createAdminClient();

		const formData = await request.formData();
		const teamId = (formData.get('team_id') as string | null) ?? '';
		if (!teamId) return fail(400, { formError: 'Missing team' });

		// Fetch challenge + track (server-side; correct answers never sent to browser before submit)
		const { data: challenge } = await supabase.from('challenges').select('*').eq('id', params.id).single();
		if (!challenge) return fail(404, { formError: 'Challenge not found' });

		const { data: ct } = await supabase.from('challenge_tracks').select('track_id').eq('challenge_id', params.id).limit(1).single();
		if (!ct) return fail(500, { formError: 'Challenge track not found' });

		const { data: track } = await admin.from('tracks').select('*').eq('id', ct.track_id).single();
		if (!track) return fail(500, { formError: 'Track not found' });

		const variant = challenge.variant;
		const variantFields: AnswerField[] = VARIANT_FIELDS[variant] ?? ['artist', 'title', 'year'];

		const pcRaw = (challenge.points_config ?? {}) as Record<string, unknown>;
		const savedModes = (pcRaw.field_modes ?? {}) as Record<string, string>;
		const fieldModes: Record<string, InputMode> = {};
		for (const f of variantFields) {
			fieldModes[f] = (savedModes[f] as InputMode) ?? DEFAULT_INPUT_MODES[variant]?.[f] ?? 'open_text';
		}
		const pointsConfig = (pcRaw.field_points ?? {}) as Record<string, number>;

		// Collect submitted answers from form; absent field = empty string (scored as 0)
		const answers: Record<string, string> = {};
		for (const f of variantFields) {
			answers[f] = (formData.get(f) as string | null) ?? '';
		}

		// Reject only if the form itself is structurally broken (field not in body at all)
		const absent = variantFields.filter((f) => formData.get(f) === null);
		if (absent.length > 0) {
			return fail(400, { formError: `Incomplete form — please try again` });
		}

		const fields = buildFieldResults(variantFields, answers, track, fieldModes, pointsConfig);
		const total = fields.reduce((s, f) => s + f.score, 0);
		const maxTotal = fields.reduce((s, f) => s + f.maxScore, 0);
		const status: SubmissionStatus = total === maxTotal ? 'auto_correct' : 'auto_wrong';

		// Insert without status column so this works before migration 0008 is run
		const { data: sub, error: subErr } = await supabase.from('submissions').insert({
			challenge_id: params.id,
			team_id: teamId,
			answers,
			score: total
		}).select('id').single();

		if (subErr) {
			if (subErr.code === '23505') return fail(409, { formError: 'Already submitted — reload to see your result' });
			return fail(500, { formError: subErr.message });
		}

		if (!sub) return fail(500, { formError: 'Submission insert returned no data' });

		// Best-effort status update — requires migration 0008; silently ignored if column missing
		await admin.from('submissions').update({ status } as never).eq('id', sub.id);

		// Increment team score via admin client (bypasses RLS)
		const { data: teamRow } = await admin.from('teams').select('score').eq('id', teamId).single();
		await admin.from('teams').update({ score: (teamRow?.score ?? 0) + total }).eq('id', teamId);

		const result: ChallengeResult = {
			total, maxTotal, fields, status, submissionId: sub.id
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
		const playerMessage = (formData.get('player_message') as string | null)?.trim() || null;

		if (!submissionId || !teamId || !fieldName) {
			return fail(400, { reviewError: 'Missing required fields' });
		}

		// Verify the submission belongs to this team
		const { data: sub } = await supabase
			.from('submissions')
			.select('id, team_id, status')
			.eq('id', submissionId)
			.eq('team_id', teamId)
			.single();

		if (!sub) return fail(403, { reviewError: 'Submission not found' });
		if (sub.status === 'review_approved') return fail(400, { reviewError: 'Already approved' });

		// Check for duplicate review request on this field
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
			player_message: playerMessage
		});
		if (rrErr) return fail(500, { reviewError: rrErr.message });

		await admin.from('submissions').update({ status: 'review_requested' }).eq('id', submissionId);

		return { reviewRequested: true, reviewedField: fieldName };
	}
};
