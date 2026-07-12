import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database.js';
import type {
	AnswerField,
	InputMode,
	FieldResult,
	SlotFieldResult,
	TabFieldResult,
	TrackFieldResult,
	ChallengeResult,
	SubmissionStatus,
	TabAnswer,
	SourceAnswer,
	ScoreBreakdown
} from '$lib/types/index.js';

export interface BonusParams {
	difficulty_rating: number; // 1–5; default 3 (neutral)
	challenge_multiplier: number; // set_challenges.challenge_multiplier; default 1
	team_score: number; // team's score BEFORE this submission
	leader_score: number; // highest score among all teams right now
	current_streak: number; // team's consecutive-score streak
	streak_thresholds: Array<{ streak: number; bonus: number }>;
	elapsed_seconds: number | null;
	speed_threshold_seconds: number | null;
	// P3b powerup effect injections (populated by submit action from team_effects rows)
	extraMultipliers?: number[]; // e.g. [1.5] from hard_gaan or single_event_mult
	insuranceActive?: boolean; // floor base to 50% of maxTotal if true
	bonusPoints?: number; // flat pts added after final calc (bonus_points powerup)
}

// ─── Field metadata ───────────────────────────────────────────────────────────

export const TYPE_FIELDS: Record<string, AnswerField[]> = {
	standard: ['artist', 'title', 'year'],
	anthem: ['festival', 'artist', 'title', 'year'],
	label: ['label', 'artist', 'title', 'year'],
	mashup: ['artist', 'title', 'year'],
	fragments: ['artist', 'title', 'year', 'grouping'],
	effects: ['artist', 'title', 'year']
};

// Keep VARIANT_FIELDS as an alias pointing at the same data
export const VARIANT_FIELDS = TYPE_FIELDS;

export const DEFAULT_INPUT_MODES: Record<string, Partial<Record<AnswerField, InputMode>>> = {
	standard: { artist: 'combobox', title: 'open_text', year: 'slider' },
	anthem: { festival: 'combobox', artist: 'combobox', title: 'open_text', year: 'slider' },
	label: { label: 'combobox', artist: 'combobox', title: 'open_text', year: 'slider' },
	mashup: { artist: 'combobox', title: 'open_text', year: 'slider' },
	fragments: { artist: 'combobox', title: 'open_text', year: 'slider', grouping: 'open_text' },
	effects: { artist: 'combobox', title: 'open_text', year: 'slider' }
};

export const FIELD_POOL_TABLE: Partial<Record<AnswerField, string>> = {
	artist: 'answer_pool_artists',
	label: 'answer_pool_labels',
	festival: 'answer_pool_festivals'
};

export const DEFAULT_FIELD_MAX: Partial<Record<AnswerField, number>> = {
	artist: 10,
	title: 10,
	year: 10,
	label: 10,
	festival: 10,
	grouping: 10
};

// ─── Configurable fields resolver (stuk 1) ────────────────────────────────────
// The SINGLE source of truth for "which fields does this challenge have, and
// each field's input mode / max points / bonus flag." When
// `points_config.fields[]` is present it wins; otherwise we derive today's
// behavior from the variant's fixed field list, the three-tier point
// resolution, and DEFAULT_INPUT_MODES — with is_bonus:false everywhere. With no
// fields[] this is bit-identical to pre-configurable-fields resolution.

export interface ResolvedField {
	name: AnswerField;
	input_mode: InputMode;
	max_points: number;
	is_bonus: boolean;
}

// Field names are constrained to the known AnswerField union this piece —
// free-form names are deferred (scoreField needs a track-backed answer).
const KNOWN_FIELDS: readonly AnswerField[] = [
	'artist',
	'title',
	'year',
	'label',
	'festival',
	'vocal_source',
	'grouping'
];

const VALID_INPUT_MODES: readonly InputMode[] = [
	'multiple_choice',
	'combobox',
	'open_text',
	'typeable_number',
	'slider'
];

export function resolveChallengeFields(
	variant: string,
	pointsConfig: unknown,
	variantDefaultPoints: Record<string, number> = {}
): ResolvedField[] {
	const pc = (pointsConfig ?? {}) as Record<string, unknown>;
	const savedModes = (pc.field_modes ?? {}) as Record<string, string>;
	const challengeFieldPoints = (pc.field_points ?? {}) as Record<string, number>;

	// Legacy resolution, reused for both the derive-from-variant path and any
	// per-row fallbacks in the configured path (so an under-specified row still
	// resolves exactly as it would have without fields[]).
	const resolveMode = (f: AnswerField): InputMode =>
		(savedModes[f] as InputMode) ?? DEFAULT_INPUT_MODES[variant]?.[f] ?? 'open_text';
	const resolvePoints = (f: AnswerField): number =>
		challengeFieldPoints[f] ?? variantDefaultPoints[f] ?? DEFAULT_FIELD_MAX[f] ?? 10;

	const configured = Array.isArray(pc.fields) ? (pc.fields as unknown[]) : null;
	if (configured && configured.length > 0) {
		const out: ResolvedField[] = [];
		for (const raw of configured) {
			if (!raw || typeof raw !== 'object') continue;
			const row = raw as Record<string, unknown>;
			const name = row.name as AnswerField;
			if (!KNOWN_FIELDS.includes(name)) continue; // ignore unknown names gracefully
			const modeRaw = row.input_mode as InputMode;
			const input_mode = VALID_INPUT_MODES.includes(modeRaw) ? modeRaw : resolveMode(name);
			const max_points =
				typeof row.max_points === 'number' && Number.isFinite(row.max_points)
					? row.max_points
					: resolvePoints(name);
			out.push({ name, input_mode, max_points, is_bonus: row.is_bonus === true });
		}
		// Only take the configured path if at least one row was valid — an all-unknown
		// fields[] falls through to the variant default rather than a fieldless challenge.
		if (out.length > 0) return out;
	}

	const variantFields = (TYPE_FIELDS[variant] ?? ['artist', 'title', 'year']) as AnswerField[];
	return variantFields.map((name) => ({
		name,
		input_mode: resolveMode(name),
		max_points: resolvePoints(name),
		is_bonus: false
	}));
}

/**
 * Flatten a ResolvedField[] into the parallel structures the scoring pipeline
 * consumes. Keeps every call site's field-map derivation identical and DRY.
 */
export function fieldMapsFromResolved(resolved: ResolvedField[]): {
	fields: AnswerField[];
	fieldModes: Record<string, InputMode>;
	fieldPoints: Record<string, number>;
	bonusFields: Set<string>;
} {
	const fieldModes: Record<string, InputMode> = {};
	const fieldPoints: Record<string, number> = {};
	const bonusFields = new Set<string>();
	for (const r of resolved) {
		fieldModes[r.name] = r.input_mode;
		fieldPoints[r.name] = r.max_points;
		if (r.is_bonus) bonusFields.add(r.name);
	}
	return { fields: resolved.map((r) => r.name), fieldModes, fieldPoints, bonusFields };
}

// ─── Track data type ──────────────────────────────────────────────────────────

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

// ─── String similarity (Levenshtein) ─────────────────────────────────────────

function editDistance(a: string, b: string): number {
	const m = a.length,
		n = b.length;
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

// Strip leading articles (EN + NL) and normalize punctuation/whitespace for
// more forgiving open-text matching at a party game.
function normalizeAnswer(s: string): string {
	return s
		.toLowerCase()
		.trim()
		.replace(/^(the|a|an|de|het|een)\s+/i, '')
		.replace(/[^\w\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function strSimilarity(a: string, b: string): number {
	const s1 = normalizeAnswer(a);
	const s2 = normalizeAnswer(b);
	if (s1 === s2) return 1;
	const maxLen = Math.max(s1.length, s2.length);
	if (maxLen === 0) return 1;
	return (maxLen - editDistance(s1, s2)) / maxLen;
}

// ─── Field scorer ─────────────────────────────────────────────────────────────

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

	// grouping is scored separately by scoreTabGrouping — return 0 here
	if (field === 'grouping') return { score: 0 };

	const trackValue = String(
		track[field === 'label' ? 'record_label' : (field as keyof TrackData)] ?? ''
	);

	if (mode === 'open_text') {
		const targets =
			field === 'title'
				? track.accepted_titles?.length
					? track.accepted_titles
					: [track.title]
				: [trackValue];
		const bestSim = Math.max(...targets.map((t) => strSimilarity(submitted, t)));
		if (bestSim >= 0.80) return { score: maxPoints, fuzzyScore: bestSim };
		if (bestSim >= 0.65) return { score: Math.round(maxPoints * 0.5), fuzzyScore: bestSim };
		return { score: 0, fuzzyScore: bestSim };
	}

	const correct = submitted.trim().toLowerCase() === trackValue.trim().toLowerCase();
	return { score: correct ? maxPoints : 0 };
}

// ─── Field results for a single slot ─────────────────────────────────────────

export function buildFieldResults(
	variantFields: AnswerField[],
	answers: Record<string, string>,
	track: TrackData,
	fieldModes: Record<string, InputMode>,
	pointsConfig: Record<string, number>,
	bonusFields: Set<string> = new Set()
): FieldResult[] {
	return variantFields
		.filter((f) => f !== 'grouping')
		.map((field) => {
			const submitted = answers[field] ?? '';
			const mode = fieldModes[field] ?? 'open_text';
			const maxScore = pointsConfig[field] ?? DEFAULT_FIELD_MAX[field] ?? 10;
			const { score, fuzzyScore } = scoreField(field, submitted, track, mode, maxScore);
			const correct =
				field === 'year'
					? String(track.year)
					: String(track[field === 'label' ? 'record_label' : (field as keyof TrackData)] ?? '');
			return { field, submitted, correct, score, maxScore, fuzzyScore, isBonus: bonusFields.has(field) };
		});
}

// ─── Grouping scorer (fragments type) ────────────────────────────────────────
// actualFragmentNumbers: sorted array of fragment_number values assigned to the matched source track
// playerFragments: the player's selected fragment numbers for this slot

export function scoreGrouping(
	playerFragments: number[],
	actualFragmentNumbers: number[],
	maxPoints: number
): number {
	const sorted = (arr: number[]) => [...arr].sort((a, b) => a - b);
	const p = sorted(playerFragments).join(',');
	const a = sorted(actualFragmentNumbers).join(',');
	return p === a ? maxPoints : 0;
}

// ─── Tab scorer ───────────────────────────────────────────────────────────────

export type TabSourceTrackData = {
	id: string; // challenge_tab_source_tracks.id
	tabId: string;
	trackId: string;
	sortOrder: number;
	track: TrackData;
};

export type TabClipData = {
	id: string;
	tabId: string;
	clipId: string;
	fragmentNumber: number | null;
	sortOrder: number;
	trackId?: string; // the clip's parent track_id (for grouping scoring)
};

// Player draft per slot within a tab
export type SlotDraft = {
	fieldValues: Record<string, string>;
	fragments?: number[]; // for fragments type
};

export function scoreTab(
	variantFields: AnswerField[],
	fieldModes: Record<string, InputMode>,
	fieldPoints: Record<string, number>,
	tabSourceTracks: TabSourceTrackData[], // ordered by sort_order
	tabClips: TabClipData[], // clips for this tab (with fragment_number)
	playerSlotDrafts: SlotDraft[], // player's answers indexed by slot
	bonusFields: Set<string> = new Set()
): {
	slotResults: SlotFieldResult[];
	tabTotal: number;
	tabMaxTotal: number;
	tabThresholdTotal: number;
	tabThresholdMax: number;
	sourceAnswers: SourceAnswer[];
} {
	const nonGroupingFields = variantFields.filter((f) => f !== 'grouping');
	const hasGrouping = variantFields.includes('grouping');
	const groupingMax = fieldPoints['grouping'] ?? DEFAULT_FIELD_MAX['grouping'] ?? 10;
	const groupingIsBonus = bonusFields.has('grouping');

	// Threshold (bonus-excluded) sums from a scored FieldResult[]; the results
	// already carry isBonus (buildFieldResults tags them from bonusFields).
	const thresholdOf = (frs: FieldResult[]): { total: number; max: number } => {
		let total = 0;
		let max = 0;
		for (const fr of frs) {
			if (fr.isBonus) continue;
			total += fr.score;
			max += fr.maxScore;
		}
		return { total, max };
	};
	// Bonus-excluded max for a field list (empty/overflow slots have no FieldResult[]).
	const nonBonusFieldMax = (fields: AnswerField[]): number =>
		fields.reduce(
			(s, f) => s + (bonusFields.has(f) ? 0 : (fieldPoints[f] ?? DEFAULT_FIELD_MAX[f] ?? 10)),
			0
		);

	if (tabSourceTracks.length === 1) {
		// ── Single-source tab (standard / anthem / label) ────────────────────────
		const src = tabSourceTracks[0];
		const draft = playerSlotDrafts[0] ?? { fieldValues: {} };
		const fieldResultsList = buildFieldResults(
			nonGroupingFields,
			draft.fieldValues,
			src.track,
			fieldModes,
			fieldPoints,
			bonusFields
		);
		const slotTotal = fieldResultsList.reduce((s, fr) => s + fr.score, 0);
		const slotMax = fieldResultsList.reduce((s, fr) => s + fr.maxScore, 0);
		const th = thresholdOf(fieldResultsList);

		const scored: Record<string, number> = {};
		for (const fr of fieldResultsList) scored[fr.field] = fr.score;

		const slotResult: SlotFieldResult = {
			slotIndex: 0,
			matchedTrackId: src.trackId,
			fields: fieldResultsList,
			total: slotTotal,
			maxTotal: slotMax
		};

		const sourceAnswer: SourceAnswer = {
			slot_index: 0,
			matched_source_track_id: src.trackId,
			field_values: draft.fieldValues,
			scored,
			total: slotTotal
		};

		return {
			slotResults: [slotResult],
			tabTotal: slotTotal,
			tabMaxTotal: slotMax,
			tabThresholdTotal: th.total,
			tabThresholdMax: th.max,
			sourceAnswers: [sourceAnswer]
		};
	}

	// ── Multi-source tab (mashup / fragments) — greedy best-match ───────────
	// For each player slot, compute total field-similarity against every unmatched source track.
	// Assign the slot to the highest-scoring match. Repeat until all slots assigned.
	const unmatched = new Set(tabSourceTracks.map((_, i) => i));
	const slotResults: SlotFieldResult[] = [];
	const sourceAnswers: SourceAnswer[] = [];
	let tabThresholdTotal = 0;
	let tabThresholdMax = 0;

	for (let slotIdx = 0; slotIdx < playerSlotDrafts.length; slotIdx++) {
		const draft = playerSlotDrafts[slotIdx] ?? { fieldValues: {} };
		let bestScore = -1;
		let bestTrackIdx = -1;
		let bestFields: FieldResult[] = [];

		for (const trackIdx of unmatched) {
			const src = tabSourceTracks[trackIdx];
			const fieldResultsList = buildFieldResults(
				nonGroupingFields,
				draft.fieldValues,
				src.track,
				fieldModes,
				fieldPoints,
				bonusFields
			);
			const total = fieldResultsList.reduce((s, fr) => s + fr.score, 0);
			if (total > bestScore) {
				bestScore = total;
				bestTrackIdx = trackIdx;
				bestFields = fieldResultsList;
			}
		}

		if (bestTrackIdx === -1) {
			// More player slots than source tracks — score 0 for overflow slots.
			// (Mirrors the max: overflow slots do NOT include groupingMax.)
			const maxTotal = nonGroupingFields.reduce(
				(s, f) => s + (fieldPoints[f] ?? DEFAULT_FIELD_MAX[f] ?? 10),
				0
			);
			tabThresholdMax += nonBonusFieldMax(nonGroupingFields);
			slotResults.push({
				slotIndex: slotIdx,
				matchedTrackId: null,
				fields: [],
				total: 0,
				maxTotal
			});
			sourceAnswers.push({
				slot_index: slotIdx,
				field_values: draft.fieldValues,
				scored: {},
				total: 0
			});
			continue;
		}

		unmatched.delete(bestTrackIdx);
		const matchedSrc = tabSourceTracks[bestTrackIdx];

		const slotMax = bestFields.reduce((s, fr) => s + fr.maxScore, 0);
		let slotTotal = bestScore;

		// Grouping field scoring for fragments type
		let groupingScore = 0;
		if (hasGrouping && draft.fragments !== undefined) {
			// Actual fragment numbers: clips whose parent track_id matches this source track
			const actualNums = tabClips
				.filter((tc) => tc.fragmentNumber !== null && tc.trackId === matchedSrc.trackId)
				.map((tc) => tc.fragmentNumber as number);
			groupingScore = scoreGrouping(draft.fragments, actualNums, groupingMax);
			slotTotal += groupingScore;
		}

		const scored: Record<string, number> = {};
		for (const fr of bestFields) scored[fr.field] = fr.score;
		if (hasGrouping) scored['grouping'] = groupingScore;

		// Add grouping field result for display
		const displayFields: FieldResult[] = [...bestFields];
		if (hasGrouping) {
			displayFields.push({
				field: 'grouping',
				submitted: (draft.fragments ?? []).join(', '),
				correct: tabClips
					.filter((tc) => tc.fragmentNumber !== null && tc.trackId === matchedSrc.trackId)
					.map((tc) => tc.fragmentNumber)
					.sort((a, b) => (a ?? 0) - (b ?? 0))
					.join(', '),
				score: groupingScore,
				maxScore: groupingMax,
				isBonus: groupingIsBonus
			});
		}

		const totalMax = slotMax + (hasGrouping ? groupingMax : 0);

		// Threshold (bonus-excluded): non-bonus regular fields + grouping when it's
		// present and not flagged bonus. Max always includes groupingMax when
		// hasGrouping (mirrors totalMax); total adds groupingScore (0 if no fragments).
		const slotTh = thresholdOf(bestFields);
		tabThresholdTotal += slotTh.total + (hasGrouping && !groupingIsBonus ? groupingScore : 0);
		tabThresholdMax += slotTh.max + (hasGrouping && !groupingIsBonus ? groupingMax : 0);

		slotResults.push({
			slotIndex: slotIdx,
			matchedTrackId: matchedSrc.trackId,
			fields: displayFields,
			total: slotTotal,
			maxTotal: totalMax
		});

		const sa: SourceAnswer = {
			slot_index: slotIdx,
			matched_source_track_id: matchedSrc.trackId,
			field_values: draft.fieldValues,
			scored,
			total: slotTotal
		};
		if (draft.fragments !== undefined) sa.fragments = draft.fragments;
		sourceAnswers.push(sa);
	}

	// Score any unmatched source tracks as 0 (player left slots empty)
	for (const trackIdx of unmatched) {
		const maxPerField = nonGroupingFields.reduce(
			(s, f) => s + (fieldPoints[f] ?? DEFAULT_FIELD_MAX[f] ?? 10),
			0
		);
		const maxTotal = maxPerField + (hasGrouping ? groupingMax : 0);
		// Mirrors maxTotal: unmatched slots DO include groupingMax (unlike overflow).
		tabThresholdMax += nonBonusFieldMax(nonGroupingFields) + (hasGrouping && !groupingIsBonus ? groupingMax : 0);
		slotResults.push({
			slotIndex: playerSlotDrafts.length + trackIdx,
			matchedTrackId: tabSourceTracks[trackIdx].trackId,
			fields: [],
			total: 0,
			maxTotal
		});
		sourceAnswers.push({
			slot_index: playerSlotDrafts.length + trackIdx,
			matched_source_track_id: tabSourceTracks[trackIdx].trackId,
			field_values: {},
			scored: {},
			total: 0
		});
	}

	const tabTotal = slotResults.reduce((s, sr) => s + sr.total, 0);
	const tabMaxTotal = slotResults.reduce((s, sr) => s + sr.maxTotal, 0);

	return { slotResults, tabTotal, tabMaxTotal, tabThresholdTotal, tabThresholdMax, sourceAnswers };
}

// ─── Source-track resolver ────────────────────────────────────────────────────
// Derives ordered TabSourceTrackData[] for a tab based on challenge type.

export type TabSourceTrackRaw = {
	id: string;
	tab_id: string;
	track_id: string;
	sort_order: number;
};

export type MashupSourceRaw = {
	id: string;
	mashup_id: string;
	track_id: string;
	sort_order: number;
};

export type ClipRaw = {
	id: string;
	track_id: string;
};

export function getSourceTracksForTab(
	challengeType: string,
	tab: { id: string; mashup_id?: string | null },
	explicitSources: TabSourceTrackRaw[],
	mashupSources: MashupSourceRaw[],
	tabClips: TabClipData[],
	clips: ClipRaw[],
	trackMap: Map<string, TrackData>
): TabSourceTrackData[] {
	if (challengeType === 'mashup') {
		if (!tab.mashup_id) return [];
		return mashupSources
			.filter((s) => s.mashup_id === tab.mashup_id)
			.sort((a, b) => a.sort_order - b.sort_order)
			.flatMap((s) => {
				const track = trackMap.get(s.track_id);
				if (!track) return [];
				return [{ id: s.id, tabId: tab.id, trackId: s.track_id, sortOrder: s.sort_order, track }];
			});
	}

	if (challengeType === 'fragments') {
		const seen = new Set<string>();
		const result: TabSourceTrackData[] = [];
		let sortOrder = 0;
		for (const tc of tabClips
			.filter((c) => c.tabId === tab.id)
			.sort((a, b) => a.sortOrder - b.sortOrder)) {
			const clip = clips.find((c) => c.id === tc.clipId);
			if (!clip || seen.has(clip.track_id)) continue;
			seen.add(clip.track_id);
			const track = trackMap.get(clip.track_id);
			if (!track) continue;
			result.push({
				id: `${tab.id}_${clip.track_id}`,
				tabId: tab.id,
				trackId: clip.track_id,
				sortOrder: sortOrder++,
				track
			});
		}
		return result;
	}

	// standard / anthem / label / effects — use explicit source tracks
	return explicitSources
		.filter((s) => s.tab_id === tab.id)
		.sort((a, b) => a.sort_order - b.sort_order)
		.flatMap((s) => {
			const track = trackMap.get(s.track_id);
			if (!track) return [];
			return [{ id: s.id, tabId: tab.id, trackId: s.track_id, sortOrder: s.sort_order, track }];
		});
}

// ─── Bonus scoring ────────────────────────────────────────────────────────────

export function computeBreakdown(base: number, bonus: BonusParams): ScoreBreakdown {
	// Floor at 1.0 so an easy challenge (rating ≤3) is neutral, never a penalty.
	// Bonus preserved on hard: rating 4 → 1.33×, rating 5 → 1.67×.
	const difficulty_multiplier = Math.max(1.0, bonus.difficulty_rating / 3);
	const round_multiplier = bonus.challenge_multiplier;
	const comeback_multiplier =
		base > 0 && bonus.leader_score > 0 && bonus.team_score < bonus.leader_score * 0.5 ? 1.5 : 1.0;

	// Additive-delta formula: multiplied = base × (1 + Σ(m_i - 1)) for all multipliers.
	// Prevents runaway stacking vs chain-multiply.
	const extraMultipliers = bonus.extraMultipliers ?? [];
	const allMultipliers = [difficulty_multiplier, round_multiplier, comeback_multiplier, ...extraMultipliers];
	const multiplied = Math.round(base * (1 + allMultipliers.reduce((sum, m) => sum + (m - 1), 0)));

	let streak_bonus = 0;
	for (const t of bonus.streak_thresholds) {
		if (bonus.current_streak >= t.streak) streak_bonus = t.bonus;
	}

	const speed_bonus =
		base > 0 &&
		bonus.elapsed_seconds !== null &&
		bonus.speed_threshold_seconds !== null &&
		bonus.elapsed_seconds <= bonus.speed_threshold_seconds
			? 5
			: 0;

	const bonus_powerup = bonus.bonusPoints ?? 0;
	const final = multiplied + streak_bonus + speed_bonus + bonus_powerup;

	return {
		base,
		difficulty_multiplier,
		round_multiplier,
		comeback_multiplier,
		streak_bonus,
		speed_bonus,
		final,
		...(bonus_powerup > 0 ? { bonus_powerup } : {}),
		...(extraMultipliers.length > 0 ? { powerup_multipliers: extraMultipliers } : {})
	};
}

// ─── Full submission scorer ───────────────────────────────────────────────────

export type TabInput = {
	tabId: string;
	tabPosition: number;
	sourceTracks: TabSourceTrackData[];
	clips: TabClipData[];
	playerDraft: SlotDraft[]; // indexed by slot
};

export function scoreSubmission(
	tabs: TabInput[],
	variantFields: AnswerField[],
	fieldModes: Record<string, InputMode>,
	fieldPoints: Record<string, number>,
	bonus?: BonusParams,
	bonusFields: Set<string> = new Set()
): {
	answersArray: TabAnswer[];
	result: Omit<ChallengeResult, 'submissionId' | 'isFinal'> & { status: SubmissionStatus };
} {
	const tabResults: TabFieldResult[] = [];
	const answersArray: TabAnswer[] = [];

	// Flat legacy tracks list for simple result display (1 slot per tab for standard/anthem/label)
	const legacyTracks: TrackFieldResult[] = [];

	// Bonus-excluded running totals — the powerup-threshold pair.
	let thresholdTotal = 0;
	let thresholdMax = 0;

	for (let i = 0; i < tabs.length; i++) {
		const tab = tabs[i];
		const { slotResults, tabTotal, tabMaxTotal, tabThresholdTotal, tabThresholdMax, sourceAnswers } =
			scoreTab(
				variantFields,
				fieldModes,
				fieldPoints,
				tab.sourceTracks,
				tab.clips,
				tab.playerDraft,
				bonusFields
			);
		thresholdTotal += tabThresholdTotal;
		thresholdMax += tabThresholdMax;

		tabResults.push({
			tabPosition: tab.tabPosition,
			tabIndex: i + 1,
			slots: slotResults,
			total: tabTotal,
			maxTotal: tabMaxTotal
		});

		answersArray.push({
			tab_position: tab.tabPosition,
			source_answers: sourceAnswers
		});

		// Populate legacyTracks for result screen (use first slot per tab)
		const firstSlot = slotResults[0];
		if (firstSlot) {
			legacyTracks.push({
				trackId: firstSlot.matchedTrackId ?? '',
				trackIndex: i + 1,
				fields: firstSlot.fields,
				total: firstSlot.total,
				maxTotal: firstSlot.maxTotal
			});
		}
	}

	const rawBase = tabResults.reduce((s, tr) => s + tr.total, 0);
	const maxTotal = tabResults.reduce((s, tr) => s + tr.maxTotal, 0);

	// Insurance: floor base to 50% of the THRESHOLD max (bonus-excluded) if active —
	// insurance guarantees half the real task, not half of optional bonus points.
	const base =
		bonus?.insuranceActive && rawBase < Math.floor(thresholdMax * 0.5)
			? Math.floor(thresholdMax * 0.5)
			: rawBase;

	// auto_correct = threshold-perfect: every non-bonus field correct. Bonus fields
	// are optional, so a blank bonus never demotes a perfect main answer to wrong.
	const status: SubmissionStatus = thresholdTotal === thresholdMax ? 'auto_correct' : 'auto_wrong';

	const breakdown = bonus ? computeBreakdown(base, bonus) : undefined;

	if (breakdown && answersArray.length > 0) {
		answersArray[0] = { ...answersArray[0], breakdown };
	}

	return {
		answersArray,
		result: {
			total: rawBase,
			maxTotal,
			thresholdTotal,
			thresholdMax,
			tabs: tabResults,
			tracks: legacyTracks,
			status,
			breakdown
		}
	};
}

// ─── Set-max score (powerup earning piece 3a, cumulative mode) ────────────────

/**
 * Sum of every challenge's base max score across a set — the denominator for
 * cumulative-mode powerup thresholds (teamScore / setMax). Mirrors the real
 * scorer: it resolves each tab's source tracks exactly like the submit path
 * (getSourceTracksForTab) and runs scoreTab with EMPTY drafts to read
 * tabMaxTotal, so the max math stays identical by construction.
 *
 * Track CONTENT never affects the max (only fieldPoints, slot count, and
 * grouping do), so a stub trackMap of placeholder tracks keyed by the
 * referenced track_ids is sufficient — this avoids loading the tracks table.
 *
 * Heavy (several queries) but called at most once per set: awardPowerups caches
 * the result in powerup_config.computed_set_max.
 */
export async function computeSetMaxScore(
	admin: SupabaseClient<Database>,
	setId: string
): Promise<number> {
	const { data: setChallengeRows } = await admin
		.from('set_challenges')
		.select('challenge_id')
		.eq('set_id', setId);
	const challengeIds = [...new Set((setChallengeRows ?? []).map((s) => s.challenge_id))];
	if (challengeIds.length === 0) return 0;

	const [challengesRes, tabsRes, vdRes] = await Promise.all([
		admin.from('challenges').select('id, variant, points_config').in('id', challengeIds),
		admin.from('challenge_tabs').select('*').in('challenge_id', challengeIds),
		admin.from('variant_defaults').select('variant, points_config')
	]);
	const challenges = challengesRes.data ?? [];
	const tabs = (tabsRes.data ?? []) as Array<{
		id: string;
		challenge_id: string;
		mashup_id?: string | null;
	}>;
	if (tabs.length === 0) return 0;
	const tabIds = tabs.map((t) => t.id);

	const vdPointsByVariant = new Map<string, Record<string, number>>();
	for (const vd of vdRes.data ?? []) {
		const fp = ((vd.points_config as Record<string, unknown> | null)?.field_points ?? {}) as Record<
			string,
			number
		>;
		vdPointsByVariant.set(vd.variant, fp);
	}

	const [stRes, clipRowsRes] = await Promise.all([
		admin.from('challenge_tab_source_tracks').select('*').in('tab_id', tabIds),
		admin.from('challenge_tab_clips').select('*').in('tab_id', tabIds)
	]);
	const sourceTracks = (stRes.data ?? []) as TabSourceTrackRaw[];
	const tabClipRows = clipRowsRes.data ?? [];

	const mashupIds = [...new Set(tabs.map((t) => t.mashup_id).filter((id): id is string => !!id))];
	const { data: mashupSourceRows } = mashupIds.length
		? await admin.from('mashup_sources').select('*').in('mashup_id', mashupIds)
		: { data: [] as MashupSourceRaw[] };
	const mashupSources: MashupSourceRaw[] = (mashupSourceRows ?? []).map((r) => ({
		id: r.id,
		mashup_id: r.mashup_id,
		track_id: r.track_id,
		sort_order: r.sort_order
	}));

	const clipIds = [...new Set(tabClipRows.map((c) => c.clip_id))];
	const { data: clipRows } = clipIds.length
		? await admin.from('clips').select('id, track_id').in('id', clipIds)
		: { data: [] as { id: string; track_id: string }[] };
	const clips: ClipRaw[] = (clipRows ?? []).map((c) => ({ id: c.id, track_id: c.track_id }));

	const tabClipData: TabClipData[] = tabClipRows.map((c) => ({
		id: c.id,
		tabId: c.tab_id,
		clipId: c.clip_id,
		fragmentNumber: c.fragment_number,
		sortOrder: c.sort_order,
		trackId: clips.find((cl) => cl.id === c.clip_id)?.track_id
	}));

	// Stub trackMap — content is irrelevant to max, only structure/count matters.
	const referencedTrackIds = new Set<string>([
		...sourceTracks.map((s) => s.track_id),
		...mashupSources.map((s) => s.track_id),
		...clips.map((c) => c.track_id).filter(Boolean)
	]);
	const trackMap = new Map<string, TrackData>();
	for (const id of referencedTrackIds) trackMap.set(id, { id, artist: '', title: '', year: 0 });

	const tabsByChallenge = new Map<string, typeof tabs>();
	for (const t of tabs) {
		const list = tabsByChallenge.get(t.challenge_id) ?? [];
		list.push(t);
		tabsByChallenge.set(t.challenge_id, list);
	}

	let setMax = 0;
	for (const ch of challenges) {
		const variant = ch.variant;
		const vdPoints = vdPointsByVariant.get(variant) ?? {};
		// Route field resolution through the single source of truth so bonus fields
		// are excluded from the cumulative-threshold denominator.
		const resolved = resolveChallengeFields(variant, ch.points_config, vdPoints);
		const { fields: variantFields, fieldModes, fieldPoints, bonusFields } =
			fieldMapsFromResolved(resolved);

		for (const tab of tabsByChallenge.get(ch.id) ?? []) {
			const resolvedSrcs = getSourceTracksForTab(
				variant,
				tab,
				sourceTracks,
				mashupSources,
				tabClipData,
				clips,
				trackMap
			);
			const { tabThresholdMax } = scoreTab(
				variantFields,
				fieldModes,
				fieldPoints,
				resolvedSrcs,
				tabClipData.filter((c) => c.tabId === tab.id),
				[], // empty drafts → tabThresholdMax is the pure bonus-excluded max
				bonusFields
			);
			setMax += tabThresholdMax;
		}
	}

	return setMax;
}
