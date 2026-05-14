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

function strSimilarity(a: string, b: string): number {
	const s1 = a.toLowerCase().trim();
	const s2 = b.toLowerCase().trim();
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
		return { score: bestSim >= 0.9 ? maxPoints : 0, fuzzyScore: bestSim };
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
	pointsConfig: Record<string, number>
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
			return { field, submitted, correct, score, maxScore, fuzzyScore };
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
	playerSlotDrafts: SlotDraft[] // player's answers indexed by slot
): {
	slotResults: SlotFieldResult[];
	tabTotal: number;
	tabMaxTotal: number;
	sourceAnswers: SourceAnswer[];
} {
	const nonGroupingFields = variantFields.filter((f) => f !== 'grouping');
	const hasGrouping = variantFields.includes('grouping');
	const groupingMax = fieldPoints['grouping'] ?? DEFAULT_FIELD_MAX['grouping'] ?? 10;

	if (tabSourceTracks.length === 1) {
		// ── Single-source tab (standard / anthem / label) ────────────────────────
		const src = tabSourceTracks[0];
		const draft = playerSlotDrafts[0] ?? { fieldValues: {} };
		const fieldResultsList = buildFieldResults(
			nonGroupingFields,
			draft.fieldValues,
			src.track,
			fieldModes,
			fieldPoints
		);
		const slotTotal = fieldResultsList.reduce((s, fr) => s + fr.score, 0);
		const slotMax = fieldResultsList.reduce((s, fr) => s + fr.maxScore, 0);

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
			sourceAnswers: [sourceAnswer]
		};
	}

	// ── Multi-source tab (mashup / fragments) — greedy best-match ───────────
	// For each player slot, compute total field-similarity against every unmatched source track.
	// Assign the slot to the highest-scoring match. Repeat until all slots assigned.
	const unmatched = new Set(tabSourceTracks.map((_, i) => i));
	const slotResults: SlotFieldResult[] = [];
	const sourceAnswers: SourceAnswer[] = [];

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
				fieldPoints
			);
			const total = fieldResultsList.reduce((s, fr) => s + fr.score, 0);
			if (total > bestScore) {
				bestScore = total;
				bestTrackIdx = trackIdx;
				bestFields = fieldResultsList;
			}
		}

		if (bestTrackIdx === -1) {
			// More player slots than source tracks — score 0 for overflow slots
			const maxTotal = nonGroupingFields.reduce(
				(s, f) => s + (fieldPoints[f] ?? DEFAULT_FIELD_MAX[f] ?? 10),
				0
			);
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
				maxScore: groupingMax
			});
		}

		const totalMax = slotMax + (hasGrouping ? groupingMax : 0);

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

	return { slotResults, tabTotal, tabMaxTotal, sourceAnswers };
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
	const difficulty_multiplier = bonus.difficulty_rating / 3;
	const round_multiplier = bonus.challenge_multiplier;
	const comeback_multiplier =
		base > 0 && bonus.leader_score > 0 && bonus.team_score < bonus.leader_score * 0.5 ? 1.5 : 1.0;

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

	const final =
		Math.round(base * difficulty_multiplier * round_multiplier * comeback_multiplier) +
		streak_bonus +
		speed_bonus;

	return {
		base,
		difficulty_multiplier,
		round_multiplier,
		comeback_multiplier,
		streak_bonus,
		speed_bonus,
		final
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
	bonus?: BonusParams
): {
	answersArray: TabAnswer[];
	result: Omit<ChallengeResult, 'submissionId' | 'isFinal'> & { status: SubmissionStatus };
} {
	const tabResults: TabFieldResult[] = [];
	const answersArray: TabAnswer[] = [];

	// Flat legacy tracks list for simple result display (1 slot per tab for standard/anthem/label)
	const legacyTracks: TrackFieldResult[] = [];

	for (let i = 0; i < tabs.length; i++) {
		const tab = tabs[i];
		const { slotResults, tabTotal, tabMaxTotal, sourceAnswers } = scoreTab(
			variantFields,
			fieldModes,
			fieldPoints,
			tab.sourceTracks,
			tab.clips,
			tab.playerDraft
		);

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

	const base = tabResults.reduce((s, tr) => s + tr.total, 0);
	const maxTotal = tabResults.reduce((s, tr) => s + tr.maxTotal, 0);
	const status: SubmissionStatus = base === maxTotal ? 'auto_correct' : 'auto_wrong';

	const breakdown = bonus ? computeBreakdown(base, bonus) : undefined;

	if (breakdown && answersArray.length > 0) {
		answersArray[0] = { ...answersArray[0], breakdown };
	}

	return {
		answersArray,
		result: { total: base, maxTotal, tabs: tabResults, tracks: legacyTracks, status, breakdown }
	};
}
