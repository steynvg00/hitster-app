import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database.js';
import { parseArtistTags } from '$lib/artist-tags';
import { thresholdOfFields } from '$lib/threshold';
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

/**
 * Parse a raw `fields[]` array (either points_config.fields[] or, from C3b, a
 * tab's fields[] override — deliberately the same row shape) into ResolvedField[].
 * Skips malformed/unknown rows gracefully (unknown name → dropped; missing/invalid
 * input_mode → resolveMode fallback; missing/invalid max_points → resolvePoints
 * fallback). Returns [] when no row was valid, so callers can fall back.
 *
 * The resolveMode/resolvePoints closures carry the fallback source (saved modes,
 * three-tier points), so an under-specified row resolves exactly as it would have
 * without an explicit fields[]. Shared by resolveChallengeFields and
 * resolveTabFields — one shape, one parser (no second shape concept).
 */
function parseFieldRows(
	rows: unknown[],
	resolveMode: (f: AnswerField) => InputMode,
	resolvePoints: (f: AnswerField) => number
): ResolvedField[] {
	const out: ResolvedField[] = [];
	for (const raw of rows) {
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
	return out;
}

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

	if (Array.isArray(pc.fields) && pc.fields.length > 0) {
		const out = parseFieldRows(pc.fields as unknown[], resolveMode, resolvePoints);
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

// ─── Per-tab fields resolver (C3b) ────────────────────────────────────────────
//
// The SINGLE source of truth for "which fields does THIS TAB have". A tab may
// carry a `fields` JSONB override (migration 0068) with the exact same row shape
// as points_config.fields[]. When present and usable it wins for that tab only;
// otherwise the tab inherits the challenge-wide resolution unchanged.
//
// Every scoring/resolution consumer that used to read the challenge-wide fields
// per tab (submit's scoreSubmission, computeSetMaxScore, the challenge page's
// priorResult rebuild) routes through here, so the moment C3c writes an override
// all three stay consistent and can't diverge — the same discipline C3a applied
// to the threshold rule.
//
// Location: kept in $lib/server/scoring.ts next to resolveChallengeFields (which
// it delegates to and reuses the parser of). ALL current consumers are
// server-side — submit.ts, computeSetMaxScore, and the challenge +page.server.ts
// load. The client (+page.svelte) renders from server-passed data and never
// resolves fields itself, so — unlike thresholdOfFields ($lib/threshold, which a
// .svelte file imports) — there is no client consumer forcing this out of
// $lib/server. `npm run build` verifies the boundary holds.
//
// Edge cases (safest = inherit, "bij twijfel: erven"):
//   - fields NULL / undefined      → inherit (the default state of every row today)
//   - fields not an array          → inherit (malformed; no override)
//   - fields = []  (empty array)   → inherit (an empty override is "no override",
//                                     never "a tab with zero fields")
//   - fields all-unknown/malformed → inherit (parseFieldRows yields [] → fall back)
//   - fields with ≥1 valid row     → OVERRIDE with the parsed rows; under-specified
//                                     rows fall back to the CHALLENGE's field_modes/
//                                     field_points (the natural fallback for a tab).
export function resolveTabFields(
	tab: { fields?: unknown } | null | undefined,
	challenge: { variant: string; points_config: unknown },
	variantDefaultPoints: Record<string, number> = {}
): ResolvedField[] {
	const raw = tab?.fields;
	if (Array.isArray(raw) && raw.length > 0) {
		// Parse the tab override with the SAME parser + fallback source as
		// points_config.fields[]: the challenge's saved modes and three-tier points.
		const pc = (challenge.points_config ?? {}) as Record<string, unknown>;
		const savedModes = (pc.field_modes ?? {}) as Record<string, string>;
		const challengeFieldPoints = (pc.field_points ?? {}) as Record<string, number>;
		const resolveMode = (f: AnswerField): InputMode =>
			(savedModes[f] as InputMode) ?? DEFAULT_INPUT_MODES[challenge.variant]?.[f] ?? 'open_text';
		const resolvePoints = (f: AnswerField): number =>
			challengeFieldPoints[f] ?? variantDefaultPoints[f] ?? DEFAULT_FIELD_MAX[f] ?? 10;

		const out = parseFieldRows(raw as unknown[], resolveMode, resolvePoints);
		if (out.length > 0) return out;
	}

	// NULL / empty / malformed / all-unknown → inherit the challenge-wide fields,
	// bit-identical to pre-C3b behaviour.
	return resolveChallengeFields(challenge.variant, challenge.points_config, variantDefaultPoints);
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
	// T1 (migration 0066). Multi-artist list; `artist` remains the joined display
	// string. Read via artistTargets() with the same array-if-present-else-scalar
	// fallback accepted_titles uses, so a pre-T1 track scores identically.
	artists?: string[] | null;
};

// ─── Artist shares (C1 stuk 1) ────────────────────────────────────────────────

/**
 * Cost per SURPLUS submitted artist tag — a tag beyond the number of targets the
 * track actually has. Deliberately small: the host's ask was "extra wrong tags
 * cost points, but minimal". Named so it's tunable in one place.
 *
 * Only surplus tags cost anything. A tag that fits within the target count but
 * simply doesn't match already costs the player its share by not matching — it is
 * NOT penalised twice.
 */
export const PENALTY_PER_SURPLUS_TAG = 1;

/**
 * Per-challenge marking of specific artists as BONUS, with their point value:
 * `{ "MC Villain": 5 }`. Stored at `challenge.points_config.artist_bonus`.
 *
 * Keyed by artist NAME, not index: a challenge spans multiple tabs with different
 * tracks, so an index would be ambiguous across them, and reordering a track's
 * artists[] would silently repoint the config. A name simply doesn't match on a
 * track that lacks that artist, which is the desired no-op. Lookup is normalized
 * (normalizeAnswer) so "mc villain" and "MC Villain" are the same key.
 *
 * Written by C1 stuk 2's editor; read here.
 */
export type ArtistBonusConfig = Record<string, number>;

/** Read `points_config.artist_bonus` into a validated name→points map. */
export function resolveArtistBonus(pointsConfig: unknown): ArtistBonusConfig {
	const pc = (pointsConfig ?? {}) as Record<string, unknown>;
	const raw = pc.artist_bonus;
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out: ArtistBonusConfig = {};
	for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
		if (normalizeAnswer(name) === '') continue;
		out[name] = value;
	}
	return out;
}

/**
 * The artist targets for a track: artists[] when set, else the scalar `artist`.
 * Exactly the accepted_titles fallback, so a track untouched since before T1
 * scores byte-identically. Empty/punctuation-only names are dropped (the same
 * unscorable-zero guard scoreField applies to every open_text target).
 */
export function artistTargets(track: TrackData): string[] {
	const raw = track.artists?.length ? track.artists : [track.artist];
	return raw.filter((a) => normalizeAnswer(a ?? '') !== '');
}

/**
 * The canonical "correct answer for this field on this track" string — exactly
 * the value buildFieldResults puts in FieldResult.correct (the results screen's
 * green answer). Extracted verbatim from that call site so the free_answer
 * powerup can reveal THE SAME string instead of maintaining a second field→column
 * map, which is how the old reveal drifted (it knew five fields and no per-tab
 * resolution). One definition, so a reveal can never disagree with the results
 * screen or with what the scorer accepts.
 *
 * `grouping` has no per-track answer (scoreTabGrouping scores it across the whole
 * tab) → '' , which callers treat as "not revealable".
 */
export function correctValueForField(field: AnswerField, track: TrackData): string {
	if (field === 'year') return String(track.year);
	if (field === 'artist') return artistTargets(track).join(' & ');
	if (field === 'grouping') return '';
	return String(track[field === 'label' ? 'record_label' : (field as keyof TrackData)] ?? '');
}

// The tag wire format lives in $lib/artist-tags (client-safe, pure) so the
// player's multi-select input (C1 stuk 2) and this scorer share ONE definition —
// this module is server-only and a .svelte component cannot import it, so a
// second copy on the client would be free to drift and silently mis-score every
// multi-artist answer. Re-exported here so existing importers are unaffected.
export { parseArtistTags, joinArtistTags, ARTIST_TAG_SEPARATOR } from '$lib/artist-tags';

export type ArtistScoreResult = {
	/** Main (threshold) points, after the surplus penalty and the zero floor. */
	mainScore: number;
	/** Always the artist field's configured max — the mains share exactly this. */
	mainMax: number;
	/** Bonus points earned, on top. Never reduced by the penalty, never negative. */
	bonusScore: number;
	/** Σ of the bonus values for bonus artists actually present on this track. */
	bonusMax: number;
	/**
	 * The bonus artists the player actually MATCHED, with the points each one
	 * contributed (C1 stuk 2 — display only). A bonus artist the player didn't
	 * guess produces no entry, so an empty array means "no bonus line to show".
	 *
	 * Points are cumulatively rounded, so Σ points === bonusScore exactly. Rounding
	 * each entry independently would let two half-credit hits (2.5 + 2.5) render as
	 * 3 + 3 = 6 under a bonusScore of 5 — a breakdown that visibly doesn't add up.
	 */
	bonusArtists: { name: string; points: number }[];
	/** Best per-pair similarity across all matched pairs (display only). */
	fuzzyScore?: number;
};

/**
 * Fraction of the points at stake for one (tag, target) pair, per input mode.
 *
 * Mode-aware ON PURPOSE — this is what preserves the regression identity for BOTH
 * modes. open_text keeps the 0.80/0.65 fuzzy tiers scoreField already applies;
 * every exact mode (combobox / multiple_choice) keeps the exact trim+lowercase
 * equality it already applies. Scoring a combobox pick fuzzily would hand full
 * credit to a near-miss that scores 0 today — a silent regression.
 */
function artistPairFraction(tag: string, target: string, mode: InputMode): number {
	if (mode === 'open_text') {
		const sim = strSimilarity(tag, target);
		if (sim >= 0.8) return 1;
		if (sim >= 0.65) return 0.5;
		return 0;
	}
	return tag.trim().toLowerCase() === target.trim().toLowerCase() ? 1 : 0;
}

/** Tags beyond this and the exact assignment falls back to greedy. See assignBest. */
const MAX_TAGS_FOR_EXACT_ASSIGNMENT = 12;

type WeightedTarget = { name: string; weight: number };
/**
 * `hits` records which targets the winning assignment actually matched, and what
 * each one earned — the aggregate `score` alone can't name them, and the results
 * screen needs the name to render "⭐ D-Sturb +5 bonus" (C1 stuk 2). Carried
 * alongside `sims` through the DP so it always describes the SAME branch the
 * score came from; recomputing it afterwards from the final score would have to
 * re-derive the assignment and could pick a different equal-scoring branch.
 */
type Assignment = {
	score: number;
	usedMask: number;
	sims: number[];
	hits: { name: string; points: number }[];
};

/**
 * Best (target → tag) assignment: each target matched at most once, each tag
 * consumed at most once, maximising the total points earned.
 *
 * EXACT, not greedy-by-similarity, because greedy provably isn't optimal here: a
 * tag that matches target A at 0.90 (full) and target B at 0.70 (half) alongside
 * a second tag that only matches A at 0.85 (full) — greedy takes the 0.90 pair
 * first and strands B, scoring full+nothing, where full+half was available. So the
 * player would be docked for a *better* guess. Bitmask DP over the tag set fixes
 * that and is trivially cheap at these sizes (targets × 2^tags × tags; realistic
 * artist lists are 2–4 names against a handful of tags).
 *
 * Weighted so mains (weight = share) and bonus artists (weight = their own points)
 * both route through one implementation.
 *
 * Pairs worth nothing are never assigned — a tag must stay free for a target it
 * can actually score.
 */
function assignBest(
	targets: WeightedTarget[],
	tags: string[],
	availableMask: number,
	mode: InputMode
): Assignment {
	if (targets.length === 0 || tags.length === 0)
		return { score: 0, usedMask: 0, sims: [], hits: [] };
	if (tags.length > MAX_TAGS_FOR_EXACT_ASSIGNMENT) {
		return assignGreedyFallback(targets, tags, availableMask, mode);
	}

	let dp = new Map<number, Assignment>();
	dp.set(0, { score: 0, usedMask: 0, sims: [], hits: [] });

	for (const t of targets) {
		const next = new Map<number, Assignment>();
		const put = (mask: number, cand: Assignment) => {
			const cur = next.get(mask);
			if (!cur || cand.score > cur.score) next.set(mask, cand);
		};
		for (const [mask, st] of dp) {
			put(mask, st); // leave this target unmatched
			for (let gi = 0; gi < tags.length; gi++) {
				const bit = 1 << gi;
				if (mask & bit) continue; // tag already used in this branch
				if (!(availableMask & bit)) continue; // tag consumed by an earlier pass
				const f = artistPairFraction(tags[gi], t.name, mode);
				if (f <= 0) continue;
				put(mask | bit, {
					score: st.score + f * t.weight,
					usedMask: st.usedMask | bit,
					sims: [...st.sims, strSimilarity(tags[gi], t.name)],
					hits: [...st.hits, { name: t.name, points: f * t.weight }]
				});
			}
		}
		dp = next;
	}

	let best: Assignment = { score: 0, usedMask: 0, sims: [], hits: [] };
	for (const [, st] of dp) if (st.score > best.score) best = st;
	return best;
}

/** Safety valve for absurd tag counts — see MAX_TAGS_FOR_EXACT_ASSIGNMENT. */
function assignGreedyFallback(
	targets: WeightedTarget[],
	tags: string[],
	availableMask: number,
	mode: InputMode
): Assignment {
	const pairs: { ti: number; gi: number; sim: number; value: number }[] = [];
	for (let ti = 0; ti < targets.length; ti++) {
		for (let gi = 0; gi < tags.length; gi++) {
			if (!(availableMask & (1 << gi))) continue;
			const f = artistPairFraction(tags[gi], targets[ti].name, mode);
			if (f > 0) {
				pairs.push({ ti, gi, sim: strSimilarity(tags[gi], targets[ti].name), value: f * targets[ti].weight });
			}
		}
	}
	pairs.sort((a, b) => b.value - a.value || b.sim - a.sim);
	const takenTargets = new Set<number>();
	const out: Assignment = { score: 0, usedMask: 0, sims: [], hits: [] };
	for (const p of pairs) {
		if (takenTargets.has(p.ti) || out.usedMask & (1 << p.gi)) continue;
		takenTargets.add(p.ti);
		out.usedMask |= 1 << p.gi;
		out.score += p.value;
		out.sims.push(p.sim);
		out.hits.push({ name: targets[p.ti].name, points: p.value });
	}
	return out;
}

/**
 * The artist field's scorer (C1 stuk 1). Pure — targets, tags and config are all
 * parameters; the combobox that collects the tags is stuk 2.
 *
 * MAIN artists share the field's points (share = max / mainCount) and are matched
 * greedily against the tags. BONUS artists are worth their configured value ON TOP
 * and are matched against whatever tags the mains didn't consume — so a missing
 * bonus artist costs nothing, exactly like a blank bonus field.
 *
 * mainMax is ALWAYS the configured max, even when every artist is marked bonus
 * (mainCount 0 → nothing can score it → 0/max). That's the migration-0038 model
 * (a) already used for a null/empty target: unscorable scores 0 for everyone and
 * the max is left alone so the misconfiguration surfaces on the results screen.
 * It also keeps this consistent with nonBonusFieldMax(), which computes the
 * threshold max from fieldPoints WITHOUT a track and so must always agree.
 */
export function scoreArtistField(
	submittedTags: string[],
	targets: string[],
	artistMaxPoints: number,
	artistBonus: ArtistBonusConfig = {},
	mode: InputMode = 'open_text'
): ArtistScoreResult {
	const bonusLookup = new Map<string, number>();
	for (const [name, pts] of Object.entries(artistBonus)) {
		bonusLookup.set(normalizeAnswer(name), pts);
	}

	const mainTargets: string[] = [];
	const bonusTargets: { name: string; points: number }[] = [];
	for (const t of targets) {
		const pts = bonusLookup.get(normalizeAnswer(t));
		if (pts !== undefined) bonusTargets.push({ name: t, points: pts });
		else mainTargets.push(t);
	}

	const bonusMax = bonusTargets.reduce((s, b) => s + b.points, 0);
	const tags = submittedTags.map((t) => t.trim()).filter(Boolean);

	// Unscorable: no targets at all (a track with a blank artist). Main scores 0;
	// the max is untouched (model (a), see docstring).
	if (mainTargets.length === 0 && bonusTargets.length === 0) {
		return {
			mainScore: 0,
			mainMax: artistMaxPoints,
			bonusScore: 0,
			bonusMax: 0,
			bonusArtists: [],
			fuzzyScore: 0
		};
	}

	const allMask = tags.length > 0 ? (1 << tags.length) - 1 : 0;
	const sims: number[] = [];

	// ── Mains: share the field's points, assigned across all tags ────────────
	let mainScore = 0;
	let usedMask = 0;
	if (mainTargets.length > 0) {
		const share = artistMaxPoints / mainTargets.length;
		const a = assignBest(
			mainTargets.map((name) => ({ name, weight: share })),
			tags,
			allMask,
			mode
		);
		mainScore = a.score;
		usedMask = a.usedMask;
		sims.push(...a.sims);
	}

	// ── Bonus: worth their own points, on only the tags the mains didn't take ──
	let bonusScore = 0;
	let bonusHits: { name: string; points: number }[] = [];
	if (bonusTargets.length > 0) {
		const b = assignBest(
			bonusTargets.map((t) => ({ name: t.name, weight: t.points })),
			tags,
			allMask & ~usedMask,
			mode
		);
		bonusScore = b.score;
		bonusHits = b.hits;
		sims.push(...b.sims);
	}

	// Round each matched bonus artist against the RUNNING total, so the per-artist
	// lines on the results screen sum to exactly the bonusScore shown in the badge.
	// See ArtistScoreResult.bonusArtists.
	let acc = 0;
	let accRounded = 0;
	const bonusArtists = bonusHits.map((h) => {
		acc += h.points;
		const points = Math.round(acc) - accRounded;
		accRounded += points;
		return { name: h.name, points };
	});

	// ── Over-guess penalty ───────────────────────────────────────────────────
	// Only when the player typed MORE names than the track has targets. Applies to
	// the main score only; bonus is on top and is never reduced (and never goes
	// negative). Main floors at 0 — the artist field can't drag a tab below zero.
	const totalTargets = mainTargets.length + bonusTargets.length;
	const surplus = Math.max(0, tags.length - totalTargets);
	const penalty = surplus * PENALTY_PER_SURPLUS_TAG;

	return {
		mainScore: Math.max(0, Math.round(mainScore) - penalty),
		mainMax: artistMaxPoints,
		bonusScore: Math.round(bonusScore),
		bonusMax,
		bonusArtists,
		fuzzyScore: sims.length > 0 ? Math.max(...sims) : 0
	};
}

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
	maxPoints: number,
	artistBonus: ArtistBonusConfig = {}
): {
	score: number;
	fuzzyScore?: number;
	bonusScore?: number;
	bonusMax?: number;
	bonusArtists?: { name: string; points: number }[];
} {
	if (field === 'year') {
		const diff = Math.abs(parseInt(submitted, 10) - track.year);
		if (diff === 0) return { score: maxPoints };
		if (diff === 1) return { score: Math.round(maxPoints * 0.5) };
		if (diff === 2) return { score: Math.round(maxPoints * 0.2) };
		return { score: 0 };
	}

	// grouping is scored separately by scoreTabGrouping — return 0 here
	if (field === 'grouping') return { score: 0 };

	// ── Artist: multi-target shares + per-challenge bonus artists (C1 stuk 1) ──
	// `score` is main+bonus (what the team is awarded); bonusScore/bonusMax carry
	// the split so scoreTab can keep the bonus portion out of the threshold math.
	// A single-artist track with a single tag reduces exactly to the old path.
	if (field === 'artist') {
		const r = scoreArtistField(
			parseArtistTags(submitted),
			artistTargets(track),
			maxPoints,
			artistBonus,
			mode
		);
		return {
			score: r.mainScore + r.bonusScore,
			fuzzyScore: r.fuzzyScore,
			bonusScore: r.bonusScore,
			bonusMax: r.bonusMax,
			bonusArtists: r.bonusArtists
		};
	}

	const trackValue = String(
		track[field === 'label' ? 'record_label' : (field as keyof TrackData)] ?? ''
	);

	if (mode === 'open_text') {
		// Only compare against targets with real content. A null/empty (or
		// punctuation-only, e.g. "?!") correct value normalizes to '' — without this
		// filter strSimilarity('','') returns 1 and EVERY submission (including a
		// blank one) would score full points on a misconfigured field. Model (a):
		// such a field is unscorable → 0 for everyone; the max is untouched so the
		// misconfiguration surfaces on the results screen. Keyed on normalizeAnswer
		// (the same normalizer scoring uses) so UI and scoring agree on "empty".
		const rawTargets =
			field === 'title'
				? track.accepted_titles?.length
					? track.accepted_titles
					: [track.title]
				: [trackValue];
		const targets = rawTargets.filter((t) => normalizeAnswer(t) !== '');
		if (targets.length === 0) return { score: 0, fuzzyScore: 0 };
		const bestSim = Math.max(...targets.map((t) => strSimilarity(submitted, t)));
		if (bestSim >= 0.80) return { score: maxPoints, fuzzyScore: bestSim };
		if (bestSim >= 0.65) return { score: Math.round(maxPoints * 0.5), fuzzyScore: bestSim };
		return { score: 0, fuzzyScore: bestSim };
	}

	// Exact-match modes (combobox / multiple_choice / any non-year mode). Same
	// unscorable-zero guard: a correct value that normalizes to '' can't be matched
	// (''===''  would otherwise hand out full points for a blank submission).
	if (normalizeAnswer(trackValue) === '') return { score: 0 };
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
	bonusFields: Set<string> = new Set(),
	artistBonus: ArtistBonusConfig = {}
): FieldResult[] {
	return variantFields
		.filter((f) => f !== 'grouping')
		.map((field) => {
			const submitted = answers[field] ?? '';
			const mode = fieldModes[field] ?? 'open_text';
			const fieldMax = pointsConfig[field] ?? DEFAULT_FIELD_MAX[field] ?? 10;
			const { score, fuzzyScore, bonusScore, bonusMax, bonusArtists } = scoreField(
				field,
				submitted,
				track,
				mode,
				fieldMax,
				artistBonus
			);
			// BASE-ONLY (C1 stuk 2 correction, reverting stuk 1's fieldMax + bonusMax).
			// maxScore is the field's DISPLAY max — the badge's denominator — and bonus
			// artists are deliberately not in it. Stuk 1 put them in, which rendered
			// "+10 / 10" on a 5-point artist field with a 5-point bonus artist AND a
			// "⭐ +5 bonus" line beneath it: the player reads 10 and then another 5, so
			// the bonus looks double-counted. Base-only badge + a separate star line
			// keeps the two quantities visually distinct.
			//
			// `score` still carries main + bonus (it is the team's contribution); the
			// badge subtracts bonusScore to display base. See the results screen.
			// Bonus was ALREADY out of thresholdMax in stuk 1 — that part was right and
			// is unchanged, so powerup earning % does not move.
			const maxScore = fieldMax;
			const correct = correctValueForField(field, track);
			return {
				field,
				submitted,
				correct,
				score,
				maxScore,
				fuzzyScore,
				isBonus: bonusFields.has(field),
				...(bonusScore !== undefined && bonusScore > 0 ? { bonusScore } : {}),
				...(bonusMax !== undefined && bonusMax > 0 ? { bonusMax } : {}),
				// Omitted entirely when nothing matched, so a no-bonus FieldResult stays
				// byte-identical to a pre-C1 one and the results screen renders no line.
				...(bonusArtists && bonusArtists.length > 0 ? { bonusArtists } : {})
			};
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
	// Unscorable-zero guard (same class as scoreField's null-value guard): a source
	// track with no fragment-numbered clips has an empty actual-nums array, and
	// [].join === [].join would hand a player who submitted no fragments full points.
	if (actualFragmentNumbers.length === 0) return 0;
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
	bonusFields: Set<string> = new Set(),
	artistBonus: ArtistBonusConfig = {}
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

	// The per-slot threshold (bonus-excluded) fold lives in $lib/threshold
	// (thresholdOfFields) — shared with the challenge page's rebuild and client
	// fallback so the grensregel can't drift across the three. See that module for
	// the whole-field / partial-bonus rationale.
	//
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
			bonusFields,
			artistBonus
		);
		const slotTotal = fieldResultsList.reduce((s, fr) => s + fr.score, 0);
		const slotMax = fieldResultsList.reduce((s, fr) => s + fr.maxScore, 0);
		const th = thresholdOfFields(fieldResultsList);

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
				bonusFields,
				artistBonus
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
			// An overflow slot has no source track and can never be scored, so it
			// contributes NOTHING to thresholdMax (the powerup-earn denominator).
			// Its display maxTotal is kept for the result screen only.
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
				maxScore: groupingMax,
				isBonus: groupingIsBonus
			});
		}

		const totalMax = slotMax + (hasGrouping ? groupingMax : 0);

		// Threshold (bonus-excluded): non-bonus regular fields + grouping when it's
		// present and not flagged bonus. Max includes groupingMax only under that
		// same gate (hasGrouping && !groupingIsBonus) — a bonus-flagged grouping is
		// excluded, unlike totalMax; total adds groupingScore (0 if no fragments).
		const slotTh = thresholdOfFields(bestFields);
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
	// C3b: optional per-tab resolved field maps (from resolveTabFields via
	// fieldMapsFromResolved). When present they OVERRIDE the challenge-wide
	// maps for THIS tab; when absent the challenge-wide params below are used.
	// The real submit path always fills this (resolveTabFields never returns
	// null — a NULL tab yields the challenge-wide maps), so the fallback is for
	// fixtures/tests that pass challenge-wide maps and no per-tab override.
	// Shape is exactly fieldMapsFromResolved's return (its `fields` key is the
	// field-name list).
	fieldMaps?: ReturnType<typeof fieldMapsFromResolved>;
};

export function scoreSubmission(
	tabs: TabInput[],
	variantFields: AnswerField[],
	fieldModes: Record<string, InputMode>,
	fieldPoints: Record<string, number>,
	bonus?: BonusParams,
	bonusFields: Set<string> = new Set(),
	artistBonus: ArtistBonusConfig = {}
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
		// C3b: prefer this tab's own resolved maps (a per-tab override) and fall
		// back to the challenge-wide params. With every tab NULL (this batch) the
		// per-tab maps ARE the challenge-wide maps, so scoring is bit-identical.
		const tf = tab.fieldMaps;
		const { slotResults, tabTotal, tabMaxTotal, tabThresholdTotal, tabThresholdMax, sourceAnswers } =
			scoreTab(
				tf?.fields ?? variantFields,
				tf?.fieldModes ?? fieldModes,
				tf?.fieldPoints ?? fieldPoints,
				tab.sourceTracks,
				tab.clips,
				tab.playerDraft,
				tf?.bonusFields ?? bonusFields,
				artistBonus
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
	// thresholdMax > 0 hardening: a challenge with NO non-bonus scorable points
	// (all-bonus / zero-field Custom, or every non-bonus field unscorable-null)
	// would satisfy 0 === 0 and hand out a free auto_correct — require real
	// threshold points to exist. No-op for existing challenges (thresholdMax > 0).
	const status: SubmissionStatus =
		thresholdMax > 0 && thresholdTotal === thresholdMax ? 'auto_correct' : 'auto_wrong';

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
		fields?: unknown; // C3b per-tab override (migration 0068)
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

		for (const tab of tabsByChallenge.get(ch.id) ?? []) {
			// C3b: resolve PER TAB via the single source of truth so a tab override
			// changes this tab's denominator contribution — and bonus fields are
			// still excluded. NULL tab → challenge-wide, bit-identical to pre-C3b.
			const { fields: variantFields, fieldModes, fieldPoints, bonusFields } =
				fieldMapsFromResolved(
					resolveTabFields(tab, { variant, points_config: ch.points_config }, vdPoints)
				);
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
