import type { AnswerField, InputMode, FieldResult, TrackFieldResult, ChallengeResult, SubmissionStatus, AnswerArrayEntry, ScoreBreakdown } from '$lib/types/index.js';

export interface BonusParams {
	difficulty_rating: number;      // 1–5; default 3 (neutral)
	challenge_multiplier: number;   // set_challenges.challenge_multiplier; default 1
	team_score: number;             // team's score BEFORE this submission
	leader_score: number;           // highest score among all teams right now
	current_streak: number;         // team's consecutive-score streak
	streak_thresholds: Array<{ streak: number; bonus: number }>;
	elapsed_seconds: number | null; // seconds from attempt start to submit; null = unknown
	speed_threshold_seconds: number | null; // null = no speed bonus for this challenge
}

export const VARIANT_FIELDS: Record<string, AnswerField[]> = {
	normal:    ['artist', 'title', 'year'],
	label:     ['label', 'artist', 'title', 'year'],
	anthem:    ['festival', 'artist', 'title', 'year'],
	vocal:     ['vocal_source', 'artist', 'year'],
	fragments: ['title', 'artist'],
	kick:      ['artist'],
	mashup:    ['artist', 'title'],
	battle:    ['artist', 'title', 'year']
};

export const DEFAULT_INPUT_MODES: Record<string, Partial<Record<AnswerField, InputMode>>> = {
	normal:    { artist: 'combobox', title: 'open_text', year: 'slider' },
	label:     { label: 'combobox', artist: 'combobox', title: 'open_text', year: 'slider' },
	anthem:    { festival: 'combobox', artist: 'combobox', title: 'open_text', year: 'slider' },
	vocal:     { vocal_source: 'combobox', artist: 'combobox', year: 'slider' },
	fragments: { title: 'open_text', artist: 'combobox' },
	kick:      { artist: 'multiple_choice' },
	mashup:    { artist: 'combobox', title: 'open_text' },
	battle:    { artist: 'combobox', title: 'open_text', year: 'slider' }
};

export const FIELD_POOL_TABLE: Partial<Record<AnswerField, string>> = {
	artist:       'answer_pool_artists',
	label:        'answer_pool_labels',
	festival:     'answer_pool_festivals',
	vocal_source: 'answer_pool_vocal_sources'
};

export const DEFAULT_FIELD_MAX: Partial<Record<AnswerField, number>> = {
	artist: 5, title: 5, year: 10, label: 5, festival: 5, vocal_source: 5
};

export type TrackData = {
	id: string;
	artist: string;
	title: string;
	year: number;
	record_label?: string | null;
	festival?: string | null;
	vocal_source?: string | null;
	accepted_titles?: string[] | null;
};

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

export function scoreField(
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
		const targets = field === 'title'
			? (track.accepted_titles?.length ? track.accepted_titles : [track.title])
			: [trackValue];
		const bestSim = Math.max(...targets.map((t) => strSimilarity(submitted, t)));
		return { score: bestSim >= 0.9 ? maxPoints : 0, fuzzyScore: bestSim };
	}

	const correct = submitted.trim().toLowerCase() === trackValue.trim().toLowerCase();
	return { score: correct ? maxPoints : 0 };
}

export function buildFieldResults(
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

export function computeBreakdown(base: number, bonus: BonusParams): ScoreBreakdown {
	const difficulty_multiplier = bonus.difficulty_rating / 3;
	const round_multiplier = bonus.challenge_multiplier;
	const comeback_multiplier =
		base > 0 && bonus.leader_score > 0 && bonus.team_score < bonus.leader_score * 0.5 ? 1.5 : 1.0;

	// Streak bonus: highest threshold the current streak meets
	let streak_bonus = 0;
	for (const t of bonus.streak_thresholds) {
		if (bonus.current_streak >= t.streak) streak_bonus = t.bonus;
	}

	// Speed bonus: flat 5 pts if submitted within threshold
	const speed_bonus =
		base > 0 &&
		bonus.elapsed_seconds !== null &&
		bonus.speed_threshold_seconds !== null &&
		bonus.elapsed_seconds <= bonus.speed_threshold_seconds
			? 5
			: 0;

	const final = Math.round(base * difficulty_multiplier * round_multiplier * comeback_multiplier) + streak_bonus + speed_bonus;

	return { base, difficulty_multiplier, round_multiplier, comeback_multiplier, streak_bonus, speed_bonus, final };
}

export function scoreSubmission(
	draftByTrack: Record<string, Record<string, string>>,
	challengeTracks: Array<{ id: string; trackId: string }>,
	trackDataMap: Map<string, TrackData>,
	variantFields: AnswerField[],
	fieldModes: Record<string, InputMode>,
	fieldPoints: Record<string, number>,
	bonus?: BonusParams
): { answersArray: AnswerArrayEntry[]; result: Omit<ChallengeResult, 'submissionId' | 'isFinal'> & { status: SubmissionStatus } } {
	const trackResults: TrackFieldResult[] = [];
	const answersArray: AnswerArrayEntry[] = [];

	for (let i = 0; i < challengeTracks.length; i++) {
		const ct = challengeTracks[i];
		const track = trackDataMap.get(ct.trackId);
		const fieldValues = draftByTrack[ct.trackId] ?? {};

		if (track) {
			const fieldResultsList = buildFieldResults(variantFields, fieldValues, track, fieldModes, fieldPoints);
			const trackTotal = fieldResultsList.reduce((s, fr) => s + fr.score, 0);
			const trackMax = fieldResultsList.reduce((s, fr) => s + fr.maxScore, 0);

			const scored: Record<string, number> = {};
			for (const fr of fieldResultsList) scored[fr.field] = fr.score;

			answersArray.push({ track_id: ct.trackId, field_values: fieldValues, scored, total: trackTotal });
			trackResults.push({ trackId: ct.trackId, trackIndex: i + 1, fields: fieldResultsList, total: trackTotal, maxTotal: trackMax });
		} else {
			// Track data missing — store empty entry, score 0
			const maxEntry = variantFields.reduce((acc, f) => { acc[f] = 0; return acc; }, {} as Record<string, number>);
			const maxTotal = variantFields.reduce((s, f) => s + (fieldPoints[f] ?? DEFAULT_FIELD_MAX[f] ?? 5), 0);
			answersArray.push({ track_id: ct.trackId, field_values: fieldValues, scored: maxEntry, total: 0 });
			trackResults.push({ trackId: ct.trackId, trackIndex: i + 1, fields: [], total: 0, maxTotal });
		}
	}

	const base = trackResults.reduce((s, tr) => s + tr.total, 0);
	const maxTotal = trackResults.reduce((s, tr) => s + tr.maxTotal, 0);
	const status: SubmissionStatus = base === maxTotal ? 'auto_correct' : 'auto_wrong';

	const breakdown = bonus ? computeBreakdown(base, bonus) : undefined;

	// Attach breakdown to the first answers entry so it's persisted in submissions.answers
	if (breakdown && answersArray.length > 0) {
		answersArray[0] = { ...answersArray[0], breakdown };
	}

	return {
		answersArray,
		result: { total: base, maxTotal, tracks: trackResults, status, breakdown }
	};
}
