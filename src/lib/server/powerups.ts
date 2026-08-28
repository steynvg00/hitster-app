import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import type {
	AnswerField,
	PowerupConfigV2,
	ThresholdMode,
	BandMode,
	PowerupTypeOverride,
	ResurrectionScoreMode,
	SafetyNetCondition,
	SafetyNetModifier
} from '$lib/types';
import {
	artistTargets,
	computeSetMaxScore,
	correctValueForField,
	groupingAnswerForTrack,
	fieldIsFullyCorrect,
	fieldMapsFromResolved,
	getSourceTracksForTab,
	resolveArtistBonus,
	resolveTabFields,
	type ClipRaw,
	type MashupSourceRaw,
	type SlotDraft,
	type TabClipData,
	type TabSourceTrackRaw,
	type TrackData
} from '$lib/server/scoring';
import { maybeTransferCrown } from '$lib/server/crown';
import {
	freeAnswerRevealKey,
	FREE_TAB_MAX_REVEALS,
	LIFELINE_MIN_ELAPSED_FRACTION,
	maskAnswer,
	X_RAY_DEFAULT_BUDGET,
	POWER_SPIN_DEFAULT_TIER_S_CHANCE,
	SPIN_TIERS,
	EYE_DEFAULT_SHOW_SCORES,
	resurrectionRetrySeconds,
	isSpinExcluded,
	type EyeSlot,
	type EyeTab,
	type EyeTeam,
	type AllSeeingEyeData,
	type PowerupTier,
	type LifelineHint,
	type RevealResult,
	type RevealTarget
} from '$lib/powerups-meta';
import type { InputMode } from '$lib/types';

export type PowerupType = Database['public']['Tables']['powerup_types']['Row'];
export type TeamPowerupRow = Database['public']['Tables']['team_powerups']['Row'];

// ─── Config v2 (powerup earning rebuild, piece 1) ────────────────────────────

const DEFAULT_THRESHOLDS_PERCENT = [25, 50, 75];

/**
 * Normalizes game_sets.powerup_config (JSONB — legacy or v2 shape) into a
 * complete v2 object with every field defaulted. This is the ONE place that
 * interprets this JSONB; pieces 2 (console) and 3 (runtime) must both go
 * through this rather than reading powerup_config directly, or the two sides
 * will drift out of sync again like thresholds_percent vs earn_threshold did.
 *
 * Legacy shapes handled:
 *   { thresholds_percent: [...] } → kept as the ladder, v2 defaults filled in
 *   { earn_threshold: N }         → treated as a single-rung ladder [N]
 *   {} | null | anything else     → full v2 defaults
 *
 * Consumed by both the admin config-save actions (piece 2) and the earning
 * runtime, awardPowerups (piece 3a). The legacy `earn_threshold` key is now
 * only read here (mapped to a single-rung ladder); nothing reads it directly.
 */
export function parseConfig(raw: unknown): PowerupConfigV2 {
	const obj =
		raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

	let thresholdsPercent: number[];
	if (
		Array.isArray(obj.thresholds_percent) &&
		obj.thresholds_percent.every((v) => typeof v === 'number')
	) {
		thresholdsPercent = obj.thresholds_percent as number[];
	} else if (typeof obj.earn_threshold === 'number') {
		thresholdsPercent = [obj.earn_threshold];
	} else {
		thresholdsPercent = DEFAULT_THRESHOLDS_PERCENT;
	}

	const thresholdMode: ThresholdMode =
		obj.threshold_mode === 'cumulative' ? 'cumulative' : 'per_challenge';
	const bandMode: BandMode = obj.band_mode === 'highest_band' ? 'highest_band' : 'all_bands';

	const types: Record<string, PowerupTypeOverride> =
		obj.types && typeof obj.types === 'object' && !Array.isArray(obj.types)
			? (obj.types as Record<string, PowerupTypeOverride>)
			: {};

	const categories: Record<string, boolean> =
		obj.categories && typeof obj.categories === 'object' && !Array.isArray(obj.categories)
			? (obj.categories as Record<string, boolean>)
			: {};

	// Preserved through the parse so console saves (which round-trip through
	// parseConfig → mergePowerupConfig) don't wipe the cumulative-mode cache.
	const computedSetMax =
		typeof obj.computed_set_max === 'number' ? obj.computed_set_max : undefined;

	return {
		version: 2,
		threshold_mode: thresholdMode,
		band_mode: bandMode,
		thresholds_percent: thresholdsPercent,
		types,
		categories,
		...(computedSetMax !== undefined ? { computed_set_max: computedSetMax } : {})
	};
}

/**
 * Merges a patch onto an already-parsed v2 config, preserving every sibling
 * key the patch doesn't touch — a thresholds-only save must not wipe `types`
 * or `categories`, and vice versa. `types`/`categories` merge one level deep
 * (by id/category key) so a single-type save doesn't drop other types'
 * overrides; the caller is responsible for merging an individual type's own
 * override fields before passing it in here.
 */
export function mergePowerupConfig(
	current: PowerupConfigV2,
	patch: Partial<PowerupConfigV2>
): PowerupConfigV2 {
	return {
		...current,
		...patch,
		types: patch.types ? { ...current.types, ...patch.types } : current.types,
		categories: patch.categories
			? { ...current.categories, ...patch.categories }
			: current.categories
	};
}

// ─── Writing powerup_config back ─────────────────────────────────────────────
//
// THE RULE: never write a config that was not merged onto the STORED object.
//
// game_sets.powerup_config is one jsonb column carrying three families of keys,
// and parseConfig models only two of them:
//
//   v2 earning keys     threshold_mode, band_mode, thresholds_percent, types,
//                       categories, computed_set_max          → modelled
//   per-type overrides  types.<id>.{enabled,threshold,chance,…}, including the
//                       values migrations 0070/0071/0072 seeded   → modelled
//   token-shop keys     starting_tokens, per_correct_challenge, streak_bonuses,
//                       time_tick_minutes, tokens_per_tick     → NOT modelled
//
// parseConfig builds a fresh object literal (see its return above), so a
// parse → merge → write round-trip silently drops the entire token-shop family.
// That is not a hypothetical: the console's powerup grid renders in BOTH modes,
// so a per-type toggle taken while a set was in token_shop mode used to wipe the
// set's token config. The worse variant was a write that skipped the merge
// altogether and replaced the whole column with a freshly-built default —
// every host override and every migration seed gone on a single click, even a
// click on the mode that was already active.
//
// These three helpers are the only sanctioned way to produce the value handed to
// `.update({ powerup_config })`. Each returns the WHOLE stored object with the
// caller's change applied on top, so keys nobody modelled ride along untouched.
// They differ only in what wins a collision:
//
//   mergeConfigPatch      a v2 patch wins over what is stored
//   mergeConfigKeys       the given raw keys win over what is stored
//   fillConfigDefaults    what is stored wins over the given defaults
//
// tests/bots/verify-config-merge-safe.ts pins both their behaviour and the rule
// itself — it reads the write sites and fails if one of them stops merging.

/** The stored jsonb as a plain object. Anything that is not one reads as `{}`. */
function rawConfigObject(raw: unknown): Record<string, unknown> {
	return raw && typeof raw === 'object' && !Array.isArray(raw)
		? { ...(raw as Record<string, unknown>) }
		: {};
}

/**
 * Apply a v2 patch and return the full object to persist. The v2 view is
 * normalized (so a legacy config is upgraded on write) and the patch wins, but
 * every unmodelled sibling key survives.
 */
export function mergeConfigPatch(
	raw: unknown,
	patch: Partial<PowerupConfigV2>
): Record<string, unknown> {
	return { ...rawConfigObject(raw), ...mergePowerupConfig(parseConfig(raw), patch) };
}

/**
 * Apply keys parseConfig does not model — the token-shop family — and return the
 * full object to persist. Deliberately does NOT run the v2 normalization: a
 * token-shop save has no business rewriting the earning ladder.
 */
export function mergeConfigKeys(
	raw: unknown,
	keys: Record<string, unknown>
): Record<string, unknown> {
	return { ...rawConfigObject(raw), ...keys };
}

/**
 * Fill in keys that are ABSENT from the stored config, never overwriting one
 * that is present. This is how a mode switch seeds that mode's defaults without
 * destroying anything — including on a repeat click, which becomes a no-op.
 */
export function fillConfigDefaults(
	raw: unknown,
	defaults: Record<string, unknown>
): Record<string, unknown> {
	return { ...defaults, ...rawConfigObject(raw) };
}

// ─── lucky_dice: the roll ─────────────────────────────────────────────────────
//
// The range is a SETTING, not a constant: it is read from
// powerup_config.types.lucky_dice.{dice_min,dice_max} — the same per-type override
// map the console already writes for enabled/threshold/chance — so a later
// settings UI can retune it without a code change. These two numbers are only the
// fallback for a set whose config predates the key (every set today).
export const LUCKY_DICE_DEFAULT_MIN = 1;
export const LUCKY_DICE_DEFAULT_MAX = 6;

/**
 * The dice range for a set, from its parsed powerup_config. Anything missing,
 * non-numeric, non-integer, below 1 or inverted (min > max) falls back to the
 * 1–6 default rather than producing a nonsense roll — a mis-typed config must not
 * be able to award 0 or negative points.
 */
export function resolveDiceRange(cfg: PowerupConfigV2): { min: number; max: number } {
	const ov = cfg.types?.lucky_dice;
	const rawMin = ov?.dice_min;
	const rawMax = ov?.dice_max;
	const ok = (n: unknown): n is number =>
		typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n) && n >= 1;
	if (!ok(rawMin) || !ok(rawMax) || rawMin > rawMax) {
		return { min: LUCKY_DICE_DEFAULT_MIN, max: LUCKY_DICE_DEFAULT_MAX };
	}
	return { min: rawMin, max: rawMax };
}

/**
 * Roll an integer in [min, max], inclusive at BOTH ends.
 *
 * The single place the randomness enters, and `rand` is injectable for exactly
 * that reason: a test can pin it (rand=()=>0 → min, rand=()=>0.999… → max) and
 * assert the boundaries instead of sampling and hoping. activatePowerup takes the
 * same injection point via ActivateOptions.rand, so the whole branch is
 * deterministic under test (tests/bots/verify-group-a.ts drives both).
 */
export function rollDice(min: number, max: number, rand: () => number = Math.random): number {
	return min + Math.floor(rand() * (max - min + 1));
}

/**
 * The three multipliers single_event_mult rolls between. Not config-driven like
 * the dice range: these three numbers ARE the card
 * ("Random multiplier (x1.2/x1.4/x1.6) applied to your next challenge."), so a
 * host who changed them would be changing what the powerup promises, not tuning
 * it. Kept as a literal tuple for that reason.
 */
export const SINGLE_EVENT_MULT_OPTIONS = [1.2, 1.4, 1.6] as const;

/**
 * Roll one of SINGLE_EVENT_MULT_OPTIONS, uniformly. `rand` is injectable for the
 * same reason rollDice's is — a test pins each of the three outcomes instead of
 * sampling and hoping (tests/bots/verify-constant-mismatches.ts drives all
 * three through activatePowerup via ActivateOptions.rand).
 *
 * The index is clamped rather than trusted: rand() is specified as [0, 1), but a
 * caller-supplied one returning exactly 1 would index past the end and write
 * `undefined` into the payload — a broken effect, where a clamp is just the top
 * option.
 */
export function rollSingleEventMult(rand: () => number = Math.random): number {
	const i = Math.min(
		SINGLE_EVENT_MULT_OPTIONS.length - 1,
		Math.floor(rand() * SINGLE_EVENT_MULT_OPTIONS.length)
	);
	return SINGLE_EVENT_MULT_OPTIONS[i];
}

/**
 * How many reveals one X-Ray activation is worth, from the set's config. Read the
 * same way the dice range is (powerup_config.types.x_ray.reveal_budget), so a
 * later settings UI tunes it like any other per-type setting. Anything missing,
 * non-integer or below 1 falls back to X_RAY_DEFAULT_BUDGET — a budget of 0 would
 * hand out a powerup that can never do anything.
 */
export function resolveXrayBudget(cfg: PowerupConfigV2): number {
	const raw = cfg.types?.x_ray?.reveal_budget;
	if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 1) {
		return X_RAY_DEFAULT_BUDGET;
	}
	return raw;
}

// ─── all_seeing_eye: the strip ───────────────────────────────────────────────
//
// THE security boundary of this powerup. Everything the Eye ever shows passes
// through stripAnswersForEye(), and it runs exactly once — at activation, before
// anything is stored — so the already-stripped snapshot is what lands in
// team_effects and what the page reads back on reload. There is no second place
// where a raw submission is turned into Eye data, and therefore no second place
// that can leak.
//
// A stored submission holds two halves:
//
//   WRITTEN by the team    field_values, fragments          → shown
//   DECIDED by the scorer  scored, total, breakdown,
//                          matched_source_track_id,
//                          (and submissions.status)         → never leaves the server
//
// Every item in the second column answers "was this right?". The Eye exists to
// show other teams' answers WITHOUT answering that, so all of it is dropped.
// matched_source_track_id is the sharpest: it is the correct track's uuid, one
// join away from the correct artist/title/year.
//
// Written as an ALLOWLIST — the output object is constructed field by field from
// a small set of names — rather than by deleting known-bad keys. A delete-list
// silently passes anything added to the submission shape later; this refuses it
// by default. The shape of the result is fixed by EyeTab/EyeSlot in
// $lib/powerups-meta, which is the contract the client renders against.

/** Coerce one field value to a display string. Values are stored as string | number. */
function eyeFieldValue(v: unknown): string | null {
	if (typeof v === 'string') return v;
	if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	return null;
}

/** field_values → a plain string map, dropping anything that isn't a scalar value. */
function eyeFieldValues(raw: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
		const v = eyeFieldValue(value);
		if (v !== null) out[field] = v;
	}
	return out;
}

/**
 * Strip one submission's `answers` down to what the Eye may show.
 *
 * Handles BOTH stored shapes, because the column has carried two over its life
 * (see the note on AnswerArrayEntry in $lib/types): the current TabAnswer[] with
 * `source_answers`, and the pre-0036 flat entries with a top-level `field_values`
 * and `track_id`. The legacy `track_id` is the same leak as
 * `matched_source_track_id` and is dropped by the same allowlist — neither is
 * ever read, so neither can be copied.
 *
 * Anything unrecognisable yields an empty list rather than a partial copy: for a
 * strip, failing closed is the only acceptable direction.
 */
export function stripAnswersForEye(answers: unknown): EyeTab[] {
	if (!Array.isArray(answers)) return [];

	const tabs: EyeTab[] = [];
	answers.forEach((rawTab, index) => {
		if (!rawTab || typeof rawTab !== 'object') return;
		const tab = rawTab as Record<string, unknown>;

		const tabPosition = typeof tab.tab_position === 'number' ? tab.tab_position : index;

		// Current shape: one entry per tab, holding a list of per-slot answers.
		if (Array.isArray(tab.source_answers)) {
			const slots: EyeSlot[] = [];
			tab.source_answers.forEach((rawSlot, slotIdx) => {
				if (!rawSlot || typeof rawSlot !== 'object') return;
				const slot = rawSlot as Record<string, unknown>;
				const fieldValues = eyeFieldValues(slot.field_values);
				const fragments = Array.isArray(slot.fragments)
					? slot.fragments.filter((n): n is number => typeof n === 'number')
					: undefined;
				slots.push({
					slotIndex: typeof slot.slot_index === 'number' ? slot.slot_index : slotIdx,
					fieldValues,
					...(fragments && fragments.length ? { fragments } : {})
				});
			});
			tabs.push({ tabPosition, slots });
			return;
		}

		// Legacy shape: field_values sits directly on the entry, one slot per tab.
		if (tab.field_values && typeof tab.field_values === 'object') {
			tabs.push({
				tabPosition,
				slots: [{ slotIndex: 0, fieldValues: eyeFieldValues(tab.field_values) }]
			});
		}
	});
	return tabs;
}

/**
 * Whether the Eye's panel also shows each finished team's total score.
 *
 * Read from powerup_config.types.all_seeing_eye.show_scores, the same per-type
 * override map the dice range and reveal budget live in. Anything that is not
 * EXACTLY boolean true is false — a truthy string or a 1 must not switch on a
 * correctness signal by accident, which is the direction that matters here.
 */
export function resolveEyeShowScores(cfg: PowerupConfigV2): boolean {
	return cfg.types?.all_seeing_eye?.show_scores === true ? true : EYE_DEFAULT_SHOW_SCORES;
}

// ─── resurrection: the settlement mode and the old score ─────────────────────

/**
 * How a Resurrection retry settles against the submission it replaces, from the
 * set's config (powerup_config.types.resurrection.score_mode) — the same per-type
 * override map the dice range, the reveal budget and the Eye's show_scores live
 * in.
 *
 * Anything that is not EXACTLY 'best' is 'replace'. The strict mode is the
 * default on purpose: under 'best' a retry can only help, which turns "when do I
 * spend this" from a decision into a button.
 */
export function resolveResurrectionScoreMode(cfg: PowerupConfigV2): ResurrectionScoreMode {
	return cfg.types?.resurrection?.score_mode === 'best' ? 'best' : 'replace';
}

/**
 * The exact number a stored submission added to teams.score.
 *
 * This is `answers[0].breakdown.final` — written by scoreAndPersistSubmission
 * (src/lib/server/submit.ts), which persists `breakdown.final` into the answers
 * array AND adds that same value to the team score, so the two cannot disagree.
 * The fallback chain handles submissions that predate the breakdown
 * (`submissions.score`, then 0) rather than guessing.
 *
 * Read ONCE, at activation, before the retry re-opens anything — the retry
 * overwrites this very row, so afterwards the number is gone. What is read here
 * is what lands in the ticket payload, and the ticket is the only thing the
 * settlement trusts.
 */
export function submissionFinalScore(sub: { answers?: unknown; score?: number | null }): number {
	const answers = sub.answers;
	if (Array.isArray(answers)) {
		const breakdown = (answers[0] as { breakdown?: { final?: unknown } } | undefined)?.breakdown;
		if (breakdown && typeof breakdown.final === 'number' && Number.isFinite(breakdown.final)) {
			return breakdown.final;
		}
	}
	return typeof sub.score === 'number' && Number.isFinite(sub.score) ? sub.score : 0;
}

/**
 * The team's OPEN Resurrection ticket for one challenge, if any.
 *
 * The ticket is a non-consumed team_effects row written at activation. It is the
 * single carrier of everything the settlement needs — old_final and score_mode,
 * both frozen at activation — and its `consumed_at IS NULL` state is what makes
 * "this submission is a retry" a fact the server can check rather than infer.
 *
 * Deliberately NOT filtered on set_id: a ticket is addressed by (team,
 * challenge), and the challenge is what the retry is for. SELECT only.
 */
export async function loadResurrectionTicket(
	supabase: SupabaseClient<Database>,
	teamId: string,
	challengeId: string
): Promise<{
	id: string;
	oldFinal: number;
	scoreMode: ResurrectionScoreMode;
	sourcePowerupId: string | null;
} | null> {
	const { data: rows } = await supabase
		.from('team_effects')
		.select('id, payload, source_team_powerup_id')
		.eq('team_id', teamId)
		.eq('effect_type', 'resurrection')
		.is('consumed_at', null);

	for (const r of rows ?? []) {
		const p = (r.payload ?? {}) as Record<string, unknown>;
		if (p.challenge_id !== challengeId) continue;
		return {
			id: r.id,
			oldFinal: typeof p.old_final === 'number' ? p.old_final : 0,
			scoreMode: p.score_mode === 'best' ? 'best' : 'replace',
			// Closed by the settlement (src/lib/server/submit.ts): the powerup goes
			// 'active' at activation and is only spent when the retry lands.
			sourcePowerupId: r.source_team_powerup_id
		};
	}
	return null;
}

/**
 * Every OTHER team that has already finished this challenge, with their answers
 * stripped for display.
 *
 * "Finished" is submissions.is_final = true — set in exactly one place
 * (scoreAndPersistSubmission, src/lib/server/submit.ts) and never unset, which is
 * why it is the honest definition of done for both the normal and the
 * auto-submit path.
 *
 * Reads with the ADMIN client, which is what the caller always passes: this is
 * another team's data, and the anon browser client cannot see it — nor should it
 * ever be asked to. Nothing here runs in a browser.
 *
 * An empty list is a legitimate answer and means "nobody has finished yet"; the
 * activation branch turns that into a refusal rather than an empty panel.
 *
 * SELECTs only, no writes — exported so a verification run can drive the real
 * function against the real database.
 */
export async function resolveAllSeeingEye(
	supabase: SupabaseClient<Database>,
	challengeId: string,
	ownTeamId: string,
	showScores: boolean
): Promise<EyeTeam[]> {
	// `score` is selected unconditionally because the strip below decides whether
	// it is used; keeping the query shape constant means the decision lives in ONE
	// readable place instead of being split between a query and a mapper.
	const { data: subs } = await supabase
		.from('submissions')
		.select('team_id, answers, score')
		.eq('challenge_id', challengeId)
		.eq('is_final', true)
		.neq('team_id', ownTeamId);

	if (!subs?.length) return [];

	const teamIds = [...new Set(subs.map((s) => s.team_id))];
	const { data: teamRows } = await supabase
		.from('teams')
		.select('id, display_name, color')
		.in('id', teamIds);
	const teamById = new Map((teamRows ?? []).map((t) => [t.id, t]));

	const out: EyeTeam[] = [];
	for (const sub of subs) {
		const team = teamById.get(sub.team_id);
		out.push({
			teamId: sub.team_id,
			displayName: team?.display_name ?? 'Unknown team',
			color: team?.color ?? 'black',
			tabs: stripAnswersForEye(sub.answers),
			// Omitted, not zeroed, when the switch is off — a client that ignores the
			// flag still finds no number to render.
			...(showScores && typeof sub.score === 'number' ? { score: sub.score } : {})
		});
	}
	// Stable order so the panel does not reshuffle between reloads.
	out.sort((a, b) => a.displayName.localeCompare(b.displayName));
	return out;
}

// ─── power_spin: the roll ────────────────────────────────────────────────────
//
// Power Spin rolls ONE powerup out of the Tier A/S pool and awards it. It does
// NOT handle the outcome — it picks a type and hands it to materializeAward(),
// the same function the earning ladder uses, so the rolled powerup behaves
// exactly as if the team had earned it (immediate-use fires, holdable goes to
// the stock, a type with a choice offers that choice).
//
// The three functions below are PURE: tier weighting, pool construction and the
// pick are all decided from data + an injected `rand`, with no database access.
// That is deliberate — it lets a verification run pin the RNG and assert the
// distribution and the exclusions without touching a live set (the same reason
// rollDice and planAwards are pure).

/**
 * How often the wheel reaches for Tier S, from the set's config
 * (powerup_config.types.power_spin.tier_s_chance). Read the same way the dice
 * range and the reveal budget are, so the A/S split is a SETTING rather than a
 * constant in the roll. Anything missing, non-finite or outside [0,1] falls back
 * to POWER_SPIN_DEFAULT_TIER_S_CHANCE — a chance above 1 would make every spin
 * reach for a tier that is empty today, and a negative one would silently kill
 * Tier S altogether.
 */
export function resolveSpinTierSChance(cfg: PowerupConfigV2): number {
	const raw = cfg.types?.power_spin?.tier_s_chance;
	if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) {
		return POWER_SPIN_DEFAULT_TIER_S_CHANCE;
	}
	return raw;
}

/**
 * Which tier the wheel reaches for. One draw, weighted: below the S chance is
 * Tier S, everything else is Tier A. This is the ROLL, not the outcome — an
 * empty tier is resolved afterwards by pickSpinType's fallback, so this function
 * stays a pure statement of the configured odds and the distribution is
 * assertable on its own.
 */
export function rollSpinTier(tierSChance: number, rand: () => number = Math.random): PowerupTier {
	return rand() < tierSChance ? 'S' : 'A';
}

/**
 * Every type Power Spin is allowed to hand out from one tier.
 *
 * Four filters, each for its own reason:
 *   - tier match — the pool this spin is drawing from.
 *   - NOT excluded — power_spin itself, plus any future type that awards a
 *     powerup. This is what makes the spin non-recursive; see
 *     SPIN_EXCLUDED_TYPE_IDS in $lib/powerups-meta for the full argument.
 *   - NOT coming_soon — an unbuilt placeholder cannot be awarded.
 *   - enabled for this set, and its category on — a host who switched a powerup
 *     off for this game must not get it back through the wheel. Same
 *     `override ?? default` resolution planAwards uses for its own pool.
 *
 * Deliberately NOT filtered on `default_inverse`. Inverse describes how a type
 * is EARNED (score below a bound rather than above one); it says nothing about
 * whether the type can be granted. A spin is not an earn, so the trait does not
 * apply — and no Tier A or S type is inverse today in any case.
 *
 * Score bounds (default_min/max_score_pct) are likewise not applied: they gate
 * the earning ladder, and the spin has already been earned by the time it rolls.
 */
export function spinPoolForTier(
	cfg: PowerupConfigV2,
	types: PowerupType[],
	tier: PowerupTier
): PowerupType[] {
	return types.filter((t) => {
		if (t.tier !== tier) return false;
		if (isSpinExcluded(t.id)) return false;
		if (t.coming_soon) return false;
		const ov = cfg.types[t.id];
		if (!(ov?.enabled ?? t.enabled_by_default)) return false;
		if (!(cfg.categories[t.category] ?? true)) return false;
		return true;
	});
}

export type SpinPick = {
	/** The tier the weighted roll asked for. */
	rolledTier: PowerupTier;
	/** The tier actually drawn from — differs from rolledTier when it fell back. */
	usedTier: PowerupTier | null;
	/** null when every tier in the chain is empty. */
	type: PowerupType | null;
};

/**
 * Roll a tier, then pick a type from it — with a fallback down SPIN_TIERS when
 * the rolled tier has no eligible members.
 *
 * The fallback is not defensive padding, it is the NORMAL case today: Tier S is
 * empty because resurrection and all_seeing_eye have not been built, so ~15% of
 * spins currently roll S and land on A. A player sees an ordinary Tier A result
 * and is told nothing about the empty shelf; the 15% starts paying out on its
 * own the moment those two types exist, with no config change.
 *
 * Both tiers empty (a host disabled every Tier A powerup for this set) yields
 * `type: null`. The caller consumes the spin and reports an empty wheel rather
 * than failing — a failed activation would leave the team_powerup row stuck on
 * 'pending', i.e. a powerup the team owns but can never see again.
 */
export function pickSpinType(
	cfg: PowerupConfigV2,
	types: PowerupType[],
	rand: () => number = Math.random
): SpinPick {
	const rolledTier = rollSpinTier(resolveSpinTierSChance(cfg), rand);

	// Try the rolled tier first, then the rest of the chain in order (S, A).
	const order = [rolledTier, ...SPIN_TIERS.filter((t) => t !== rolledTier)];
	for (const tier of order) {
		const pool = spinPoolForTier(cfg, types, tier);
		if (!pool.length) continue;
		return { rolledTier, usedTier: tier, type: pool[Math.floor(rand() * pool.length)] };
	}
	return { rolledTier, usedTier: null, type: null };
}

export type EarnedPowerup = {
	teamPowerupId: string;
	type: PowerupType;
	// Present when type.immediate_use — the effect was auto-activated at earn time.
	activation?: ActivateResult;
};

// ─── Earning v2: pure planner (piece 3a) ─────────────────────────────────────

/**
 * Lifeline's designed drop rate: it appears on about half the submissions that
 * qualify for it (a LOW score — it is an inverse type, migration 0071:85).
 *
 * This constant exists because that 0.5 used to live in exactly one place: a
 * per-set jsonb seed written by migration 0071:113-127. A migration can only
 * reach rows that exist when it runs, and neither set-creation path writes a
 * `types` subtree — `create` inserts no powerup_config at all (so the column
 * default from migration 0033:18-20 applies) and `createFromPreset` writes a
 * preset literal, none of which carries one. Every set made after that
 * migration therefore fell through to the generic `?? 1` below and dropped
 * Lifeline at DOUBLE the designed rate, silently.
 *
 * lucky_dice and power_spin never had this problem because each pairs its seed
 * with a code constant and a resolver (LUCKY_DICE_DEFAULT_MIN/MAX above,
 * POWER_SPIN_DEFAULT_TIER_S_CHANCE in $lib/powerups-meta). Their seeds are
 * belt-and-braces; Lifeline's was load-bearing. This is Lifeline's half of that
 * same pattern, and it is the fix rather than a migration for one reason: a
 * migration cannot reach a set that does not exist yet.
 */
export const LIFELINE_DEFAULT_CHANCE = 0.5;

/**
 * Per-type earn-chance defaults, for the types whose designed rate is not 1.
 * A type absent here keeps the historical `?? 1`, so this map changes nothing
 * for the other nineteen.
 *
 * Only the inverse channel consults any of this now (see LADDER_CHANCE), which
 * in practice makes lifeline's entry the only one that can matter.
 */
const DEFAULT_TYPE_CHANCE: Record<string, number> = {
	lifeline: LIFELINE_DEFAULT_CHANCE
};

/**
 * The probability one eligible type actually drops: the set's own value if the
 * host (or a migration) set one, otherwise the type's designed default,
 * otherwise 1.
 *
 * The INVERSE CHANNEL's rate, and since LADDER_CHANCE below, only that. The
 * ladder no longer reads it — see that constant for why the two channels stopped
 * sharing this one. The console still resolves it for display
 * (powerup-console.ts), which is what keeps a host reading lifeline's real 0.5
 * rather than a plausible 1.
 *
 * This is the STATIC rate — a property of the type and the set, the same for
 * every team. The inverse channel multiplies it by the team's own safety-net
 * factor at the point of the roll (resolveChanceModifier); that is deliberately
 * kept out of here, for the same reason resolveWeightModifier is kept out of
 * resolveTypeWeight: one function answers "what did the host configure", the
 * other "what is this team's situation", and folding them together would make
 * the first unanswerable.
 */
export function resolveTypeChance(cfg: PowerupConfigV2, typeId: string): number {
	const override = cfg.types?.[typeId]?.chance;
	if (typeof override === 'number' && Number.isFinite(override)) return override;
	return DEFAULT_TYPE_CHANCE[typeId] ?? 1;
}

/**
 * The ladder's earn chance, and the whole of it: every type in the pool takes
 * part in every draw, so a fired band with a non-empty pool ALWAYS pays out.
 *
 * THE RULE it encodes: qualifying IS the pool. A team whose score lands in the
 * range of at least one ladder type earns a powerup; a team whose score lands in
 * none earns nothing. There is no third outcome where a qualifying team is
 * turned away by a coin flip.
 *
 * A constant rather than a resolver default, because a default is precisely what
 * a stored override beats. Sets created before this change carry `chance` values
 * in their powerup_config jsonb — the console used to write them — so a
 * `?? 1` fallback would leave exactly the sets a host has already tuned still
 * rolling. Reading a constant at the call site is the only form no stored value
 * can reach.
 *
 * Scoped to the LADDER on purpose, because the inverse channel's chance is not
 * the same quantity wearing the same name. That channel has no pool and no pick:
 * a rate is the only knob it has, it is the endpoint the safety net bends
 * (resolveChanceModifier), and lifeline's designed 0.5 is a drop-rate rather
 * than a lottery a candidate can lose. Neutralising it there would delete a
 * mechanism, not a coin flip.
 *
 * Stored `chance` values on ladder types are now inert. They are left in place
 * rather than migrated away: nothing reads them, and rewriting every set's
 * config is a far larger risk than a dead key (see "Writing powerup_config back"
 * above). The console stops offering the input, so no new ones appear.
 */
export const LADDER_CHANCE = 1;

/**
 * The neutral weight. 1 for every type until a host sets otherwise, which is
 * what makes the weighted pick bit-identical to the uniform one it replaced.
 */
export const DEFAULT_TYPE_WEIGHT = 1;

/**
 * How OFTEN a type is drawn relative to the others that made it into the same
 * pool — powerup_config.types[id].weight, read exactly like `chance` above.
 *
 * chance and weight answer DIFFERENT questions, and since the ladder's chance
 * became the constant 1 (LADDER_CHANCE) weight is the only one of the two the
 * ladder still has:
 *
 *   weight  given that every pool type takes part, how the draw splits between
 *           them. It moves the RATIO without touching how often a band pays out
 *           — which is exactly why it, and not chance, is the ladder's rarity
 *           knob: lowering a type's chance to make it rarer also made empty
 *           bands commoner, and an empty band handed a qualifying team nothing.
 *   chance  survives on the inverse channel only, where it is a drop-rate rather
 *           than a lottery a candidate can lose (resolveTypeChance).
 *
 * Only the ladder's pick consults this. The inverse channel has no pool and no
 * pick — every inverse type decides for itself against its own chance — so a
 * weight there would have nothing to be relative TO, and is ignored by design.
 * That asymmetry is also why the safety net has two endpoints rather than one:
 * on the ladder it multiplies this weight, on the inverse channel it multiplies
 * the chance, because that is the only quantity each channel has (see the laag 4
 * header below).
 *
 * 0 is a VALID setting (never drawn, while the rest keep their ratio). Negative,
 * non-finite and absent all fall back to the neutral 1: a negative weight would
 * corrupt the cumulative sum and could make later candidates unreachable, which
 * is a silently wrong lottery rather than a loud one.
 */
export function resolveTypeWeight(cfg: PowerupConfigV2, typeId: string): number {
	const override = cfg.types?.[typeId]?.weight;
	if (typeof override === 'number' && Number.isFinite(override) && override >= 0) return override;
	return DEFAULT_TYPE_WEIGHT;
}

// ─── Weighted lottery (earning laag 3) ───────────────────────────────────────
//
// The generic weighted draw. Pure and rand-injectable like rollDice /
// rollSingleEventMult / rollSpinTier above, and written as ONE draw for a reason
// that matters beyond elegance: the uniform pick it replaces also consumed
// exactly one rand(), so every pinned-RNG test keeps its sequence alignment.
//
// ── Why a cumulative sum, and not a fixed ratio table ───────────────────────
// The candidate list is DIFFERENT on every draw — it is whatever the pool filter
// admitted at this submission's score (and, until LADDER_CHANCE became 1, what
// then survived the per-type chance roll). A fixed "shield is 20% of all awards"
// table cannot express that, because 20% of what depends on who else showed up. A cumulative sum over the candidates ACTUALLY PRESENT normalizes
// itself: weight 3 against weight 1 is 3:1 among those two whenever both are
// there, and 3 alone takes everything when the other is filtered out. That is
// the property the wandering pool needs.
//
// ── Neutral weights are bit-identical, not merely equivalent ────────────────
// With every weight 1 the running total after i+1 candidates is exactly i+1, so
// `draw < acc` first holds at i = floor(draw) = floor(rand() * n) — the very
// index the old `rolled[Math.floor(rand() * rolled.length)]` computed. Same
// index, same single rand() call, for every n and every draw. The strict `<` is
// load-bearing: `<=` would land on the wrong candidate whenever draw falls
// exactly on a boundary (n=2, rand()=0.5 → draw 1.0 → index 1, not 0).
// tests/bots/verify-weighted-lottery.ts pins this exhaustively rather than
// trusting the argument.

export type WeightedCandidate<T> = { item: T; weight: number };

/**
 * Draw one candidate, with probability proportional to its weight.
 *
 * Three edges, each resolved the way the rest of this module resolves a
 * malformed setting — fall back to something sane rather than produce nonsense
 * (see resolveDiceRange / resolveSpinTierSChance):
 *
 *   empty list      → null. The caller keeps its existing "nothing to pick"
 *                     branch; this function does not invent an award.
 *   total weight 0  → uniform. Every candidate having weight 0 is a
 *                     misconfiguration, not an instruction to award nothing:
 *                     "never hand this out" is what `enabled` and `chance` are
 *                     for. Silently dropping the award would make a mis-typed
 *                     config look like bad luck for a whole evening.
 *   one candidate   → that one, always (it takes the whole interval).
 *
 * A single weight of 0 alongside positive ones is NOT an edge case — it is a
 * meaningful setting and works: a zero-width interval can never contain the
 * draw, so that candidate is never picked while the others keep their ratio.
 */
export function weightedPick<T>(
	candidates: WeightedCandidate<T>[],
	rand: () => number = Math.random
): T | null {
	if (!candidates.length) return null;

	let total = 0;
	for (const c of candidates) total += c.weight;

	// Written as `!(total > 0)` so NaN — which every comparison answers false —
	// takes the uniform branch too, instead of falling through to a draw that no
	// interval can ever contain.
	if (!(total > 0)) {
		const i = Math.min(candidates.length - 1, Math.floor(rand() * candidates.length));
		return candidates[i].item;
	}

	const draw = rand() * total;
	let acc = 0;
	for (const c of candidates) {
		acc += c.weight;
		if (draw < acc) return c.item;
	}
	// Unreachable for finite weights (draw < total, and acc ends at total), but a
	// float-rounding backstop is cheaper than a null the caller must handle.
	return candidates[candidates.length - 1].item;
}

// ─── Score range (earning laag 1) ────────────────────────────────────────────
//
// THE RULE: a type's score range is `min ≤ score% ≤ max`, INCLUSIVE at both ends,
// read the same way for every type. Nothing about it depends on `inverse`.
//
// ── What this replaced, and why it had to go ────────────────────────────────
// There used to be ONE config key, `threshold`, whose meaning depended on a flag
// on a different table:
//
//   normal type   threshold overrode default_min_score_pct  → LOWER bound, `>=`
//   inverse type  threshold overrode default_max_score_pct  → UPPER bound, `<`
//
// Three separate things rode on that one key — which column it overrode, which
// side of the range it sat on, and whether the bound itself counted — and the
// only way to know which was to go look at `default_inverse`. On top of that an
// inverse type had NO lower bound at all, so "penalty_shot only between 10% and
// 40%" was not expressible: a team that scored 0% because it never saw the
// challenge was indistinguishable from one that scored 39% by playing badly.
//
// Now: two keys that always mean the same thing, one predicate both channels
// call, and `inverse` reduced to what it should always have been — a label for
// WHICH EARN CHANNEL a type uses, saying nothing about bounds (see
// isInverseChannel).

/**
 * The lower edge of a type's score range: the set's override if present,
 * otherwise the catalog column (powerup_types.default_min_score_pct, migration
 * 0044:12). Validated like every other resolver here — out-of-range, non-finite
 * and absent all fall back to the column rather than producing a bound that can
 * never be met.
 */
export function resolveMinScorePct(cfg: PowerupConfigV2, type: PowerupType): number {
	const override = cfg.types?.[type.id]?.min_score_pct;
	if (
		typeof override === 'number' &&
		Number.isFinite(override) &&
		override >= 0 &&
		override <= 100
	) {
		return override;
	}
	return type.default_min_score_pct;
}

/**
 * The upper edge, mirroring resolveMinScorePct. This is the half that was NOT
 * overridable before — it read the column directly — which is why a host could
 * raise a type's floor but never give it a ceiling.
 */
export function resolveMaxScorePct(cfg: PowerupConfigV2, type: PowerupType): number {
	const override = cfg.types?.[type.id]?.max_score_pct;
	if (
		typeof override === 'number' &&
		Number.isFinite(override) &&
		override >= 0 &&
		override <= 100
	) {
		return override;
	}
	return type.default_max_score_pct;
}

/**
 * Is this submission's score inside the type's range? The ONE place the bounds
 * are compared, called by both earning channels so they cannot drift on either
 * the edges or their inclusivity.
 *
 * Inclusive at both ends. For the ladder that is what it always was (`>=` and
 * `<=`). For the inverse channel it is a DELIBERATE change: that channel used a
 * strict `<`, so a submission landing exactly on the bound (40.0% for lifeline
 * and penalty_shot) did not fire. It now does. That single edge is the only
 * behavioural difference this rewrite makes anywhere — pinned exhaustively, over
 * the real catalog and every score, by tests/bots/verify-threshold-range.ts.
 *
 * An inverted range (min > max) admits nothing. That is the honest reading of a
 * host asking for "between 60% and 40%" — a contradiction — rather than silently
 * swapping the bounds into an instruction nobody gave.
 */
export function scoreInRange(cfg: PowerupConfigV2, type: PowerupType, scorePct: number): boolean {
	return scorePct >= resolveMinScorePct(cfg, type) && scorePct <= resolveMaxScorePct(cfg, type);
}

/**
 * Which earn channel a type uses — and, since laag 1, NOTHING else.
 *
 * true  → the inverse channel: earned per submission for scoring LOW, with no
 *         band ladder behind it.
 * false → the ladder: bands fire, chance decides who takes part, weight decides
 *         who wins.
 *
 * It no longer implies anything about which bound is which, or whether a bound
 * is inclusive. `override.inverse ?? default_inverse` keeps the existing
 * resolution; no console control writes the override, so in practice this is the
 * type's fixed trait (lifeline and penalty_shot, and nothing else).
 */
export function isInverseChannel(cfg: PowerupConfigV2, type: PowerupType): boolean {
	return cfg.types?.[type.id]?.inverse ?? type.default_inverse;
}

/**
 * The gates both channels share: a type that is unbuilt, switched off for this
 * set, or in a switched-off category is not awardable through either route.
 * Extracted so the two loops below visibly agree on them — the differences
 * between the channels should be the interesting part, not a duplicated
 * three-line preamble that can drift.
 */
function typeIsAvailable(cfg: PowerupConfigV2, type: PowerupType): boolean {
	if (type.coming_soon) return false;
	if (!(cfg.types?.[type.id]?.enabled ?? type.enabled_by_default)) return false;
	if (!(cfg.categories[type.category] ?? true)) return false;
	return true;
}

// ─── Vangnet-modifiers (earning laag 4) ──────────────────────────────────────
//
// Two axes describing how badly this team is doing, folded into ONE number: a
// multiplier. Everything below is pure; the reads that feed the axes live in
// awardPowerups.
//
// ── One evaluation, two endpoints ───────────────────────────────────────────
// The rule is a statement about the TEAM ("behind, and playing badly"), so it is
// evaluated once, by resolveModifierFactor. What that factor then multiplies
// depends on which channel the type earns through, because the two channels do
// not have the same knob — the split resolveTypeWeight documents:
//
//   ladder           has a pool and a draw, so a net is a WEIGHT
//                    (weight_modifier → resolveWeightModifier, applied in the
//                    band loop). The rescue WINS MORE OFTEN WHEN SOMETHING
//                    DROPS; it does not make drops more frequent.
//   inverse channel  has neither — every inverse type decides for itself against
//                    its own chance — so there is nothing for a weight to be
//                    relative to and a net must be a RATE (chance_modifier →
//                    resolveChanceModifier, applied in the inverse loop).
//
// Each key is ignored on the channel it does not belong to, which is why the
// same team profile can safely carry both.
//
// Today only lifeline uses the chance endpoint. penalty_shot is the other
// inverse type and deliberately carries no modifier: a safety net that hands out
// punishments faster the worse you are doing is not a safety net.

/**
 * Where a team sits in its set's standings, as a fraction: 1 = leader, 0 = last,
 * independent of how many teams are playing.
 *
 * ── Ties take the midrank, and that is load-bearing ─────────────────────────
 * The obvious formula — "fraction of teams strictly below me" — has a trap at
 * exactly the moment the game starts: every team is on 0, every team has nobody
 * below it, so every team reads as 0 = dead last, and a "bottom 30%" safety net
 * fires for the ENTIRE field. That is the "everyone qualifies" failure this
 * whole laag exists to avoid, arriving through the tie rule rather than through
 * the threshold.
 *
 * Midrank — below + half of the teams level with you — puts a fully tied field
 * at 0.5, which is the honest answer: nobody is behind anybody.
 *
 * Returns undefined when the answer is unknown (empty standings, or this team
 * is not among them). Undefined never satisfies a condition — see
 * resolveWeightModifier. A single team returns 1 rather than dividing by zero:
 * a lone team leads, and a safety net must not fire for it.
 */
export function computePositionPercentile(
	standings: Array<{ id: string; score: number }>,
	teamId: string
): number | undefined {
	const n = standings.length;
	if (n === 0) return undefined;
	const self = standings.find((t) => t.id === teamId);
	if (!self) return undefined;
	if (n === 1) return 1;

	let below = 0;
	let equal = 0;
	for (const t of standings) {
		if (t.score < self.score) below++;
		else if (t.score === self.score) equal++;
	}
	return (below + (equal - 1) / 2) / (n - 1);
}

/**
 * The team's share of fields it got FULLY right, as a fraction 0–1, folded from
 * the per-submission counts migration 0077 persists.
 *
 * SUM/SUM, not the mean of per-challenge percentages — 0077's own reasoning:
 * summing weights every field equally, while averaging percentages would let a
 * one-field challenge count as much as a five-field one.
 *
 * Rows written before 0077 carry NULL and are skipped, exactly as the SQL SUM()
 * the migration described would skip them. A row with fields_total = 0 is
 * skipped too — it contributes nothing and would only risk a divide-by-zero.
 *
 * Returns undefined when NOTHING was measured, and that is deliberate: 0 would
 * read as "got everything wrong" and hand the safety net to a team that has not
 * played yet. It is the same trap 0077 avoided by making the columns nullable
 * instead of DEFAULT 0, and it must not come back one layer up.
 */
export function computeFieldsCorrectFraction(
	rows: Array<{ fields_correct: number | null; fields_total: number | null }>
): number | undefined {
	let correct = 0;
	let total = 0;
	for (const r of rows) {
		const c = r.fields_correct;
		const t = r.fields_total;
		if (typeof c !== 'number' || typeof t !== 'number') continue;
		if (!Number.isFinite(c) || !Number.isFinite(t) || t <= 0) continue;
		correct += c;
		total += t;
	}
	if (total <= 0) return undefined;
	return correct / total;
}

/**
 * Does ANY type in this set carry a weight modifier — the ladder's endpoint?
 */
export function hasAnyWeightModifier(cfg: PowerupConfigV2): boolean {
	for (const ov of Object.values(cfg.types ?? {})) {
		if (ov?.weight_modifier) return true;
	}
	return false;
}

/**
 * Does ANY type in this set carry a chance modifier — the inverse channel's?
 */
export function hasAnyChanceModifier(cfg: PowerupConfigV2): boolean {
	for (const ov of Object.values(cfg.types ?? {})) {
		if (ov?.chance_modifier) return true;
	}
	return false;
}

/**
 * Does this set need the axes measured at all? The gate that keeps this laag
 * free for every set that does not use it — which is every set today. When
 * false, awardPowerups skips the axis work entirely (no extra query), and every
 * modifier would have resolved to 1 anyway.
 *
 * It exists as ONE function rather than an `||` at the call site because of the
 * failure it prevents, which is silent: a modifier whose axes were never
 * measured reads every condition as unknown, and an unknown axis never matches
 * (conditionHolds), so the modifier resolves to a neutral 1 and looks exactly
 * like a host who configured nothing. Nothing errors and nothing logs. EVERY
 * endpoint that reads an axis must be OR'd in here — adding a reader without
 * adding it to this line is how that failure gets shipped.
 */
export function needsSafetyNetAxes(cfg: PowerupConfigV2): boolean {
	return hasAnyWeightModifier(cfg) || hasAnyChanceModifier(cfg);
}

/** The axis value this condition reads, or undefined when it is unknown. */
function axisValue(axis: unknown, ctx: PlanContext): number | undefined {
	if (axis === 'position') return ctx.positionPercentile;
	if (axis === 'performance') return ctx.fieldsCorrectFraction;
	return undefined; // unknown axis name — a config from the future, or a typo
}

/**
 * One condition. FALSE on anything it cannot positively confirm — an unknown
 * axis, an axis the context does not carry, a bound that is not a number, or no
 * bound at all. Unknown must never trigger the safety net: a team with no
 * measurable performance yet is not a team that is doing badly.
 */
function conditionHolds(c: SafetyNetCondition, ctx: PlanContext): boolean {
	if (!c || typeof c !== 'object') return false;
	const value = axisValue(c.axis, ctx);
	if (typeof value !== 'number' || !Number.isFinite(value)) return false;

	const hasLte = typeof c.lte === 'number' && Number.isFinite(c.lte);
	const hasGte = typeof c.gte === 'number' && Number.isFinite(c.gte);
	// A condition with no bound constrains nothing. Reading it as "always true"
	// would let a half-written config multiply everything.
	if (!hasLte && !hasGte) return false;

	if (hasLte && !(value <= (c.lte as number))) return false;
	if (hasGte && !(value >= (c.gte as number))) return false;
	return true;
}

/**
 * THE evaluation, and the whole of it: does this rule match this team's
 * situation, and if so what does it multiply by? 1 = untouched.
 *
 * Deliberately says nothing about WHAT is multiplied. A modifier is a rule about
 * the team, not about the quantity — which is what lets the ladder's weight and
 * the inverse channel's chance share one implementation instead of each carrying
 * a near-copy of the and/or logic that can drift. The two thin readers below
 * supply the only difference there is: which config key to look in.
 *
 * Every malformed or incomplete shape resolves to 1, the same posture
 * resolveTypeWeight / resolveDiceRange take: a mis-typed config should behave
 * like no config, not like a silently different game. Three of those fallbacks
 * are not merely defensive — they are the ones that would otherwise misfire:
 *
 *   empty conditions   `[].every()` is TRUE, so an and-modifier with nothing in
 *                      it would multiply EVERYTHING. Caught explicitly.
 *   missing combine    with two or more conditions there is no safe default (see
 *                      SafetyNetModifier) — the modifier stays off until the host
 *                      says which. With exactly one condition and/or cannot
 *                      differ, so it is allowed to be absent.
 *   negative factor    nonsense at either endpoint: it would corrupt
 *                      weightedPick's cumulative sum on the ladder, and make a
 *                      chance that can never fire on the inverse channel. 0 is
 *                      fine and meaningful at both (never drawn / never drops).
 */
export function resolveModifierFactor(
	mod: SafetyNetModifier | undefined,
	ctx: PlanContext
): number {
	if (!mod || typeof mod !== 'object') return 1;

	const factor = mod.factor;
	if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 0) return 1;

	const conditions = Array.isArray(mod.conditions) ? mod.conditions : [];
	if (conditions.length === 0) return 1;
	if (conditions.length > 1 && mod.combine !== 'and' && mod.combine !== 'or') return 1;

	const held = conditions.map((c) => conditionHolds(c, ctx));
	const matched = mod.combine === 'or' ? held.some(Boolean) : held.every(Boolean);
	return matched ? factor : 1;
}

/**
 * The multiplier this type's LOTTERY WEIGHT gets — the ladder's endpoint. Read
 * from powerup_config.types[id].weight_modifier; absent resolves to a neutral 1.
 */
export function resolveWeightModifier(
	cfg: PowerupConfigV2,
	typeId: string,
	ctx: PlanContext
): number {
	return resolveModifierFactor(cfg.types?.[typeId]?.weight_modifier, ctx);
}

/**
 * The multiplier this type's DROP-RATE gets — the inverse channel's endpoint.
 * Read from powerup_config.types[id].chance_modifier; absent resolves to a
 * neutral 1, which is an exact no-op because `chance × 1` returns the same float.
 *
 * Only the inverse loop consults this, and a type is only reached there when it
 * is on that channel, so a chance_modifier parked on a ladder type does nothing.
 * That is the mirror of `weight_modifier` being ignored on an inverse type, and
 * both follow from the same fact: the two channels have different knobs.
 */
export function resolveChanceModifier(
	cfg: PowerupConfigV2,
	typeId: string,
	ctx: PlanContext
): number {
	return resolveModifierFactor(cfg.types?.[typeId]?.chance_modifier, ctx);
}

export type PlannedAward = { typeId: string; channel: 'ladder' | 'inverse' };

export type PlanContext = {
	submissionPct: number; // this submission's score % (drives type-eligibility everywhere)
	cumulativePct: number; // teamScore / setMax % (only used by cumulative band-firing)
	thresholdMode: ThresholdMode;
	bandMode: BandMode;
	lastThresholdCrossed: number; // teams.last_threshold_crossed (cumulative highwater)
	// ── Safety-net axes (laag 4) ──────────────────────────────────────────────
	// BOTH are FRACTIONS 0–1, unlike the two `…Pct` fields above which are 0–100.
	// The names say so on purpose: a `positionPct` sitting next to `submissionPct`
	// with a different unit is a bug waiting to be written.
	//
	// Optional, and absent is a real state rather than a gap to be filled: it
	// means the axis could not be measured (no standings, or the team has no
	// scored submissions yet). An absent axis never satisfies a condition, so a
	// context without either — which is every caller that does not opt in, and
	// every existing test that builds this object — behaves exactly as before.
	positionPercentile?: number; // 1 = leader, 0 = last, ties at midrank
	fieldsCorrectFraction?: number; // SUM(fields_correct) / SUM(fields_total)
};

/**
 * Pure earning planner — no DB, deterministic given `rand`. The heart of piece 3;
 * unit-swept in isolation (scripts sweep every mode × band × chance combination).
 *
 * Model:
 *  - Bands that fire:
 *      per_challenge → every threshold ≤ this submission's score % (no persistence;
 *        the submissions unique constraint prevents a challenge firing twice).
 *      cumulative    → thresholds in (lastThresholdCrossed, cumulativePct] — a
 *        game-long highwater. `newHighwater` is the max band crossed (before the
 *        highest_band reduction) so the caller can CAS-claim it.
 *  - band_mode highest_band collapses the fired bands to just the top one, but the
 *    highwater still advances past all of them (the lower bands are spent).
 *  - Normal pool (same for every band): available types (typeIsAvailable) that are
 *    NOT on the inverse channel and whose score is in range (scoreInRange:
 *    min ≤ submissionPct ≤ max, inclusive, overridable per set).
 *  - x bands = x awards whenever the pool is non-empty: every pool type takes
 *    part in every band's draw (LADDER_CHANCE is 1, so nothing is filtered out),
 *    and one is drawn by weight × the team's safety-net factor (weightedPick,
 *    resolveWeightModifier). An EMPTY pool is the only way a fired band pays
 *    nothing — that is the score landing outside every type's range, i.e. not
 *    qualifying, rather than bad luck.
 *  - Inverse channel (per submission, ladder-independent): each available inverse
 *    type whose score is in range — the SAME predicate — rolls its chance × the
 *    team's safety-net factor (resolveChanceModifier).
 *
 * Since laag 1 the properties are independent, and each means exactly one thing:
 * RANGE says between which scores a type is eligible (scoreInRange), CHANNEL
 * says how it is earned (isInverseChannel), WEIGHT says in what proportion the
 * ladder draws it, and CHANCE — on the inverse channel alone — says how often it
 * drops. Lifeline is still expressible as "range 0-40, channel inverse, chance
 * 0.5" with all three independently tunable — and, since laag 4, "and 2× that
 * chance while this team is in the bottom third" on top.
 *
 * Laag 4's two factors are the only part of this that depends on WHO is playing;
 * both are a neutral 1 unless the set's config asks for them, so a set that does
 * not use the safety net plans exactly the awards it planned before it existed.
 */
export function planAwards(
	cfg: PowerupConfigV2,
	types: PowerupType[],
	ctx: PlanContext,
	rand: () => number
): { awards: PlannedAward[]; newHighwater: number | null } {
	const thresholds = [...cfg.thresholds_percent].sort((a, b) => a - b);

	let crossed: number[];
	if (ctx.thresholdMode === 'cumulative') {
		crossed = thresholds.filter((t) => t > ctx.lastThresholdCrossed && t <= ctx.cumulativePct);
	} else {
		crossed = thresholds.filter((t) => t <= ctx.submissionPct);
	}

	// Highwater advances to the max band crossed, regardless of highest_band.
	const newHighwater =
		ctx.thresholdMode === 'cumulative' && crossed.length ? Math.max(...crossed) : null;

	if (cfg.band_mode === 'highest_band' && crossed.length) crossed = [Math.max(...crossed)];

	const pool = types.filter((t) => {
		if (!typeIsAvailable(cfg, t)) return false;
		// Channel, not bounds: an inverse type earns through its own route below,
		// so it never joins the ladder's pool. Its RANGE is checked there with the
		// very same predicate this line's neighbour uses.
		if (isInverseChannel(cfg, t)) return false;
		return scoreInRange(cfg, t, ctx.submissionPct);
	});

	const awards: PlannedAward[] = [];

	// Ladder channel: one roll-and-pick per fired band.
	//
	// The roll below no longer DECIDES anything: it rolls against LADDER_CHANCE,
	// which is 1, so every pool type takes part in every band and a fired band
	// with a non-empty pool always pays out. Qualifying is the pool; reaching the
	// pool is the whole of it.
	//
	// It stays a roll rather than collapsing to `const rolled = pool` for one
	// reason — the rand() BUDGET. Every pinned-RNG argument in this module and in
	// the bots counts draws: one per pool type, then one for the pick (see
	// weightedPick's neutrality proof above, and verify-weighted-lottery's "2
	// chance-rolls + 1 trekking = 3 rand-aanroepen"). Dropping the calls would
	// shift every seeded sequence by the size of the pool, turning a
	// behaviour-neutral change into a suite-wide reshuffle. `rand() < 1` is always
	// true (Math.random lives in [0, 1)), so the filter is a no-op that keeps the
	// stream aligned.
	//
	// One winner is drawn from those candidates by a weighted lottery rather than
	// a uniform index. With every weight at its default 1 the two are the same
	// draw (see weightedPick), so that half is inert until a weight is set.
	//
	// Laag 4 adds ONE multiplication inside that same map: the host's static
	// weight times this team's safety-net modifier. It is the whole of the
	// mechanism, and it is deliberately here rather than inside resolveTypeWeight
	// so the two stay separable — a weight is a property of the TYPE, a modifier
	// is a property of the type AND this team's situation.
	//
	// Neutrality is exact, not approximate: with no weight_modifier configured
	// resolveWeightModifier returns 1 for every type, so these are the same
	// numbers laag 3 built, so the cumulative-sum argument above weightedPick
	// (which reasons only about the weights) carries over untouched — same
	// candidate array, same single rand(), same index.
	for (let i = 0; i < crossed.length; i++) {
		const rolled = pool.filter(() => rand() < LADDER_CHANCE);
		if (rolled.length) {
			const pick = weightedPick(
				rolled.map((t) => ({
					item: t,
					weight: resolveTypeWeight(cfg, t.id) * resolveWeightModifier(cfg, t.id, ctx)
				})),
				rand
			);
			// Non-null for a non-empty list; the guard is for the type, not a case.
			if (pick) awards.push({ typeId: pick.id, channel: 'ladder' });
		}
	}

	// Inverse channel: per-submission, independent of the ladder / highwater.
	//
	// The channel is what makes these types different — earned for scoring LOW,
	// with no band behind it. Their score RANGE is not: it comes from the same
	// scoreInRange the pool above uses, which is what finally gives an inverse
	// type a real lower bound (0% "never played it" is now separable from 39%
	// "played badly", if a host sets one).
	//
	// The range is checked BEFORE the chance roll, exactly as the old `<` was: a
	// type out of range must not consume a rand() draw.
	//
	// Laag 4's second endpoint is the multiplication below, and it is the mirror
	// of the ladder's: the host's static rate times this team's safety-net
	// modifier. A RATE rather than a weight because this channel has no pool —
	// there is nothing here for a weight to be relative to, so making the rescue
	// arrive more often is the only thing a net can do (see resolveTypeWeight).
	//
	// Three properties, none of them accidental:
	//   exact when neutral   with no chance_modifier the factor is 1, and
	//                        `chance × 1` returns the same float — not merely a
	//                        close one. The comparison is bit-identical.
	//   self-clamping        rand() lives in [0, 1), so a product at or above 1
	//                        always fires and one at or below 0 never does. No
	//                        clamp is needed for the roll to stay a probability.
	//   same rand() budget   still exactly one draw per eligible type, so every
	//                        pinned-RNG test keeps its sequence alignment (the
	//                        property weightedPick's neutrality proof relies on).
	for (const t of types) {
		if (!isInverseChannel(cfg, t)) continue;
		if (!typeIsAvailable(cfg, t)) continue;
		if (!scoreInRange(cfg, t, ctx.submissionPct)) continue;
		const chance = resolveTypeChance(cfg, t.id) * resolveChanceModifier(cfg, t.id, ctx);
		if (rand() < chance) {
			awards.push({ typeId: t.id, channel: 'inverse' });
		}
	}

	return { awards, newHighwater };
}

// ─── Earning v2: IO wrapper (piece 3a) ───────────────────────────────────────

/**
 * Insert a pending team_powerup and auto-activate it if it's an immediate-use type.
 *
 * THE award path. Everything that grants a powerup during play goes through here
 * — the earning ladder (awardPowerups), the dev force, and power_spin's roll —
 * which is precisely why the spin can hand a rolled type over and get the right
 * behaviour for free: this function is what decides "fire now" vs "offer the
 * store/lose choice", from the type's own flags.
 *
 * `challengeId` is nullable because not every grant has a challenge behind it:
 * team_powerups.granted_from_challenge_id has always been nullable
 * (0044_powerups_runtime.sql), and a spin activated outside a challenge has no
 * id to pass on.
 */
async function materializeAward(
	supabase: SupabaseClient<Database>,
	teamId: string,
	setId: string,
	challengeId: string | null,
	type: PowerupType
): Promise<EarnedPowerup | null> {
	const { data: inserted } = await supabase
		.from('team_powerups')
		.insert({
			team_id: teamId,
			set_id: setId,
			powerup_type_id: type.id,
			granted_from_challenge_id: challengeId,
			status: 'pending'
		})
		.select('id')
		.single();
	if (!inserted) return null;

	// Immediate-use types (bonus_points, hard_gaan, single_event_mult) have no
	// store/hold step — auto-activate right away via the existing machinery.
	if (type.immediate_use) {
		const activation = await activatePowerup(supabase, inserted.id, { allowFromPending: true });
		return { teamPowerupId: inserted.id, type, activation };
	}
	return { teamPowerupId: inserted.id, type };
}

/**
 * Read the cached set-max, or compute + cache it (cumulative mode only).
 *
 * Takes the RAW stored config alongside the parsed one because this writes: the
 * cache is a single key, and merging it onto the parsed view would drop the
 * token-shop family with it (see "Writing powerup_config back" above). Nothing
 * about the earning decision changes — only what survives the write.
 */
async function getOrComputeSetMax(
	supabase: SupabaseClient<Database>,
	setId: string,
	cfg: PowerupConfigV2,
	rawConfig: unknown
): Promise<number> {
	if (typeof cfg.computed_set_max === 'number') return cfg.computed_set_max;
	const setMax = await computeSetMaxScore(supabase, setId);
	// Cache back into powerup_config. NOT invalidated when the set's challenge list
	// changes (that goes through a different action) — acceptable party-game staleness.
	const merged = mergeConfigPatch(rawConfig, { computed_set_max: setMax });
	await supabase
		.from('game_sets')
		.update({ powerup_config: merged as never })
		.eq('id', setId);
	return setMax;
}

/**
 * The performance axis, read for one team in one set (laag 4).
 *
 * Set-scoped through set_challenges because `submissions` carries no set_id — it
 * is keyed on (challenge_id, team_id) only. Without that scoping this would pool
 * together every set the team has ever played. In practice the reset SQL clears
 * submissions between games so the two rarely differ, but "rarely differ" is not
 * a property to build an earning rule on.
 *
 * Runs AFTER this submission's row is written (scoreAndPersistSubmission inserts
 * before it calls awardPowerups), so the current challenge is included — the
 * team's performance as of now, not as of a moment ago.
 *
 * Two queries, and only when a modifier is configured — see the gate in
 * awardPowerups.
 */
async function loadFieldsCorrectFraction(
	supabase: SupabaseClient<Database>,
	teamId: string,
	setId: string
): Promise<number | undefined> {
	const { data: setChallengeRows } = await supabase
		.from('set_challenges')
		.select('challenge_id')
		.eq('set_id', setId);
	const challengeIds = [...new Set((setChallengeRows ?? []).map((s) => s.challenge_id))];
	if (challengeIds.length === 0) return undefined;

	const { data: rows } = await supabase
		.from('submissions')
		.select('fields_correct, fields_total')
		.eq('team_id', teamId)
		.in('challenge_id', challengeIds);
	return computeFieldsCorrectFraction(rows ?? []);
}

/**
 * Award powerups for a scored submission (piece 3a). Reads the v2 config, plans
 * awards via the pure planner, and materializes them — returning ALL awards from
 * this submission (x crossed bands = up to x awards, plus any inverse award).
 *
 * Structured so piece 3b's auto-submit backstop can call this from a second site.
 */
export async function awardPowerups(
	supabase: SupabaseClient<Database>,
	teamId: string,
	setId: string,
	challengeId: string,
	submissionPct: number,
	forcePowerupTypeId?: string,
	// Laag 4: the set's teams with their current scores, in canonical order. The
	// caller has these already (scoreAndPersistSubmission loads them for the
	// leader score), so the position axis costs no query here. Absent → that axis
	// is simply unknown, and an unknown axis never satisfies a condition.
	standings?: Array<{ id: string; score: number }>
): Promise<EarnedPowerup[]> {
	const { data: gameSet } = await supabase
		.from('game_sets')
		.select('powerups_enabled, powerup_config')
		.eq('id', setId)
		.maybeSingle();
	if (!gameSet?.powerups_enabled) return [];

	// Dev force (one-shot cookie, cleared by caller): award exactly the requested
	// type, bypassing the ladder entirely — preserves the old force behavior.
	if (forcePowerupTypeId) {
		const { data: forcedType } = await supabase
			.from('powerup_types')
			.select('*')
			.eq('id', forcePowerupTypeId)
			.maybeSingle();
		if (!forcedType) return [];
		const earned = await materializeAward(supabase, teamId, setId, challengeId, forcedType);
		return earned ? [earned] : [];
	}

	const cfg = parseConfig(gameSet.powerup_config);
	const { data: types } = await supabase.from('powerup_types').select('*').order('sort_order');
	if (!types?.length) return [];

	let cumulativePct = 0;
	let lastThresholdCrossed = 0;
	if (cfg.threshold_mode === 'cumulative') {
		const { data: team } = await supabase
			.from('teams')
			.select('score, last_threshold_crossed')
			.eq('id', teamId)
			.maybeSingle();
		lastThresholdCrossed = team?.last_threshold_crossed ?? 0;
		const setMax = await getOrComputeSetMax(supabase, setId, cfg, gameSet.powerup_config);
		cumulativePct = setMax > 0 ? ((team?.score ?? 0) / setMax) * 100 : 0;
	}

	// ── Safety-net axes (laag 4) ──────────────────────────────────────────────
	// Gated on the config actually using them. With no type carrying a modifier —
	// every set today — nothing below runs, so this laag adds zero queries and
	// both axes stay undefined, which is exactly what a context without them
	// already meant.
	//
	// The gate asks needsSafetyNetAxes, NOT any single endpoint's own predicate:
	// a set whose only modifier is a chance_modifier needs these axes just as
	// much, and gating on the weight endpoint alone would leave them undefined,
	// silently neutralising the modifier the host did configure.
	let positionPercentile: number | undefined;
	let fieldsCorrectFraction: number | undefined;
	if (needsSafetyNetAxes(cfg)) {
		positionPercentile = standings ? computePositionPercentile(standings, teamId) : undefined;
		fieldsCorrectFraction = await loadFieldsCorrectFraction(supabase, teamId, setId);
	}

	const plan = planAwards(
		cfg,
		types as PowerupType[],
		{
			submissionPct,
			cumulativePct,
			thresholdMode: cfg.threshold_mode,
			bandMode: cfg.band_mode,
			lastThresholdCrossed,
			positionPercentile,
			fieldsCorrectFraction
		},
		Math.random
	);

	let awards = plan.awards;

	// Cumulative: claim the highwater via compare-and-swap BEFORE inserting ladder
	// awards. A lost race means a concurrent submission already claimed these bands,
	// so drop the ladder awards — but keep inverse awards (they're per-submission).
	if (cfg.threshold_mode === 'cumulative' && plan.newHighwater !== null) {
		const { data: claimed } = await supabase
			.from('teams')
			.update({ last_threshold_crossed: plan.newHighwater } as never)
			.eq('id', teamId)
			.eq('last_threshold_crossed', lastThresholdCrossed)
			.select('id');
		if (!claimed?.length) awards = awards.filter((a) => a.channel === 'inverse');
	}

	const typeById = new Map((types as PowerupType[]).map((t) => [t.id, t]));
	const earned: EarnedPowerup[] = [];
	for (const a of awards) {
		const t = typeById.get(a.typeId);
		if (!t) continue;
		const e = await materializeAward(supabase, teamId, setId, challengeId, t);
		if (e) earned.push(e);
	}
	return earned;
}

// ─── Active effects helper ────────────────────────────────────────────────────

export type ActiveEffect = {
	id: string;
	effect_type: string;
	payload: Record<string, unknown>;
	expires_at: string | null;
	source_team_powerup_id: string | null;
};

/**
 * Load all non-consumed (and non-expired for window effects) team_effects for a team+set.
 * Called in the submit action to derive extraMultipliers / insurance / bonusPoints.
 */
export async function loadActiveEffects(
	supabase: SupabaseClient<Database>,
	teamId: string,
	setId: string
): Promise<ActiveEffect[]> {
	const { data } = await supabase
		.from('team_effects')
		.select('id, effect_type, payload, expires_at, source_team_powerup_id')
		.eq('team_id', teamId)
		.eq('set_id', setId)
		.is('consumed_at', null);
	return (data ?? []).map((r) => ({
		id: r.id,
		effect_type: r.effect_type,
		payload: (r.payload ?? {}) as Record<string, unknown>,
		expires_at: r.expires_at,
		source_team_powerup_id: r.source_team_powerup_id
	}));
}

/**
 * Derive scoring modifiers from active team effects.
 * Returns extraMultipliers, insuranceActive, bonusPoints, and IDs of effects to consume after scoring.
 */
export function deriveEffectModifiers(effects: ActiveEffect[]): {
	extraMultipliers: number[];
	insuranceActive: boolean;
	bonusPoints: number;
	doubleDownPct: number | null;
	toConsume: ActiveEffect[];
} {
	const now = Date.now();
	const extraMultipliers: number[] = [];
	let insuranceActive = false;
	let bonusPoints = 0;
	let doubleDownPct: number | null = null;
	const toConsume: ActiveEffect[] = [];

	for (const e of effects) {
		const expired = e.expires_at ? new Date(e.expires_at).getTime() <= now : false;
		if (expired) continue;

		switch (e.effect_type) {
			case 'hard_gaan': {
				const mult = (e.payload.multiplier as number | undefined) ?? 1.5;
				extraMultipliers.push(mult);
				// Window-based: do NOT consume on this submission; expires naturally
				break;
			}
			case 'single_event_mult': {
				const mult = (e.payload.multiplier as number | undefined) ?? 1.5;
				extraMultipliers.push(mult);
				toConsume.push(e);
				break;
			}
			case 'insurance': {
				insuranceActive = true;
				toConsume.push(e);
				break;
			}
			case 'bonus_points': {
				bonusPoints += (e.payload.value as number | undefined) ?? 5;
				toConsume.push(e);
				break;
			}
			case 'double_down': {
				// The only effect whose multiplier is NOT knowable here: it depends on
				// the percentage this submission scores, which does not exist until
				// scoreSubmission has folded every tab. So this hands the raw prediction
				// through to the scorer instead of a number, and computeBreakdown — the
				// one place with both the prediction and the threshold pair in scope —
				// resolves it into the same additive-delta sum as the multipliers above.
				//
				// Only one can be active (activatePowerup guard 3); if a stale row ever
				// slipped past, the first wins rather than two bets compounding.
				const pct = e.payload.predicted_pct as number | undefined;
				if (typeof pct === 'number' && Number.isFinite(pct) && doubleDownPct === null) {
					doubleDownPct = pct;
				}
				// Consumed win or lose, like single_event_mult: the bet rode this
				// submission and does not carry over to the next challenge.
				toConsume.push(e);
				break;
			}
		}
	}

	return { extraMultipliers, insuranceActive, bonusPoints, doubleDownPct, toConsume };
}

/**
 * Mark a set of team_effects as consumed after a submission has been scored.
 * Also marks the linked team_powerup rows as 'consumed' (except hard_gaan which is window-based).
 */
export async function consumeEffects(
	supabase: SupabaseClient<Database>,
	effects: ActiveEffect[],
	challengeId: string
): Promise<void> {
	if (effects.length === 0) return;
	const now = new Date().toISOString();
	await Promise.all(
		effects.map(async (e) => {
			await supabase
				.from('team_effects')
				.update({ consumed_at: now, consumed_challenge_id: challengeId })
				.eq('id', e.id);
			if (e.source_team_powerup_id) {
				await supabase
					.from('team_powerups')
					.update({ status: 'consumed' } as never)
					.eq('id', e.source_team_powerup_id);
			}
		})
	);
}

// ─── Activation ───────────────────────────────────────────────────────────────

export type ActivateOptions = {
	field?: string; // free_answer: which field to reveal
	// free_answer: WHICH answer to reveal. A field name alone is not an address —
	// a multi-tab challenge has one track per tab, a mashup/fragments tab one per
	// answer slot. Omitted → only resolvable on a single-tab challenge.
	// By uuid, not position: positions are not unique (see freeAnswerRevealKey).
	tabId?: string; // challenge_tabs.id of the tab being answered
	slotIndex?: number; // answer slot within that tab (0 for single-source tabs)
	currentChallengeId?: string; // free_answer / time_boost / insurance gating
	targetTeamId?: string; // offensive types (give_a_shot, …): the team being attacked
	// double_down: the percentage the team predicts it will score on the next
	// challenge (0–100). The first team-CHOSEN numeric parameter in the powerup
	// system — free_answer's `field` is the closest precedent, but that picks one
	// of a fixed list, where this is a free value the scorer reads back later.
	predictedPct?: number;
	// Immediate-use types (bonus_points, hard_gaan, single_event_mult) auto-activate
	// straight from the earn path, before the player ever "holds" them.
	allowFromPending?: boolean;
	// lucky_dice: the randomness source, injectable so the roll is assertable in a
	// test (see rollDice). Defaults to Math.random in production.
	rand?: () => number;
	// x_ray / free_tab: the (tab, slot, field) addresses to reveal. Each one is
	// resolved by the SAME helper free_answer's single `field` goes through — this
	// is a longer list of the same thing, not a different mechanism.
	revealTargets?: RevealTarget[];
	// lifeline: the team's CURRENT draft, keyed by String(tab.position) exactly as
	// the submit path keys it. Lifeline only hints at cells the team has not got
	// right yet, and the draft lives in the browser's localStorage until submit —
	// so there is no server-side copy to read and the client must send it. Absent
	// or unparseable is treated as an empty draft: every field gets a hint.
	lifelineDraft?: Record<string, SlotDraft[]>;
	// resurrection: WHICH finished challenge to bring back. The only option that
	// names a challenge the team is NOT currently on — every other challenge-scoped
	// type uses currentChallengeId, because every other one acts on the challenge in
	// front of you. Falls back to currentChallengeId so activating from the
	// challenge page itself ("or it is the current one") needs no extra field.
	resurrectionChallengeId?: string;
};

/**
 * Read double_down's prediction out of an activation form post. Shared by every
 * ?/activatePowerup action (the challenge page and /team) so the field name lives
 * in one place — the same reason parseRevealAddress exists for free_answer's
 * tab/slot pair. Returns {} for a missing or non-numeric value; activatePowerup's
 * own range check is the authority on what is acceptable, so a bad value is
 * rejected there with a message rather than silently clamped here.
 */
export function parsePredictedPct(fd: FormData): { predictedPct?: number } {
	const raw = (fd.get('predicted_pct') as string | null)?.trim();
	if (!raw) return {};
	const n = Number(raw);
	return Number.isFinite(n) ? { predictedPct: n } : {};
}

/**
 * Read x_ray / free_tab's target list out of an activation form post. Same role
 * as parseRevealAddress (free_answer's single tab/slot pair) and parsePredictedPct
 * (double_down's number): the form field name lives in ONE place, shared by every
 * ?/activatePowerup action.
 *
 * Posted as JSON because the payload is a list of triples, which url-encoded form
 * fields express badly. Anything unparseable yields {} — activatePowerup's own
 * per-powerup caps and the resolver are the authority on what is acceptable, so a
 * malformed list is refused there with a message rather than silently trimmed here.
 */
export function parseRevealTargets(fd: FormData): { revealTargets?: RevealTarget[] } {
	const raw = (fd.get('reveal_targets') as string | null)?.trim();
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return {};
		const targets = parsed
			.filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
			.map((t) => ({
				tabId: typeof t.tabId === 'string' && t.tabId ? t.tabId : undefined,
				slotIndex: typeof t.slotIndex === 'number' ? t.slotIndex : 0,
				field: typeof t.field === 'string' ? t.field : ''
			}))
			.filter((t) => t.field !== '');
		return targets.length ? { revealTargets: targets } : {};
	} catch {
		return {};
	}
}

/**
 * Read lifeline's draft snapshot out of an activation form post. Same role as
 * parseRevealTargets and parsePredictedPct: the form field name lives in ONE
 * place, shared by every ?/activatePowerup action.
 *
 * Posted as JSON under the same `answers_json` shape the submit action already
 * parses (Record<tabPosition, SlotDraft[]>) — the page builds it with the very
 * function it submits with, so what lifeline judges and what the scorer would
 * score cannot diverge.
 *
 * Anything unparseable yields {} rather than an error: an empty draft simply
 * produces a hint on every field, which is the safe direction to fail in.
 */
export function parseLifelineDraft(fd: FormData): {
	lifelineDraft?: Record<string, SlotDraft[]>;
} {
	const raw = (fd.get('lifeline_draft') as string | null)?.trim();
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return { lifelineDraft: parsed as Record<string, SlotDraft[]> };
	} catch {
		return {};
	}
}

/**
 * Read resurrection's target challenge out of an activation form post. Same role
 * as parsePredictedPct / parseRevealTargets / parseLifelineDraft: the form field
 * name lives in ONE place, shared by every ?/activatePowerup action.
 *
 * Absent yields {} — activatePowerup then falls back to currentChallengeId, which
 * is what makes "or it is the current one" work without a second code path.
 */
export function parseResurrectionChallengeId(fd: FormData): { resurrectionChallengeId?: string } {
	const raw = (fd.get('resurrection_challenge_id') as string | null)?.trim();
	return raw ? { resurrectionChallengeId: raw } : {};
}

export type ActivateResult = {
	success: boolean;
	error?: string;
	effectId?: string;
	revealedValue?: string; // free_answer only
	revealedTags?: string[]; // free_answer on `artist`: the scorer's targets, for the tag input
	revealedTabId?: string; // free_answer: which tab the value belongs to
	revealedSlotIndex?: number; // free_answer: which answer slot within that tab
	// x_ray / free_tab: every reveal this activation produced, each fully addressed
	// exactly like free_answer's single one. free_answer keeps its four singular
	// fields (its contract is untouched); the client normalises both into the same
	// RevealResult[] before applying them, so there is one apply path, not two.
	reveals?: RevealResult[];
	// lifeline: the masked hints this activation produced. NOT reveals — nothing
	// here is written into the draft and no unmasked answer is present.
	lifelineHints?: LifelineHint[];
	payload?: Record<string, unknown>; // the team_effects payload that was written
	blocked?: boolean; // offensive types: the target's shield absorbed the attack
	// power_spin only: the powerup the wheel landed on, already materialized
	// through the normal award path. Absent when the wheel came up empty.
	//
	// It is a full EarnedPowerup — the same object the earning ladder returns —
	// so the client can push it onto the reveal queue and let it show its OWN
	// card (store/lose, or its immediate-use confirmation). The spin does not
	// flatten or reinterpret it; that is the whole point of routing through
	// materializeAward.
	spun?: EarnedPowerup;
	// all_seeing_eye: every finished team's answers, ALREADY STRIPPED by
	// stripAnswersForEye. This is the only Eye data that ever crosses to a client,
	// and its type (AllSeeingEyeData) has no room for a score breakdown, a per-field
	// verdict or a matched track id — so the contract is enforced by shape, not by
	// remembering to delete things.
	allSeeingEye?: AllSeeingEyeData;
	// resurrection: what was re-opened, so the client can send the team straight to
	// it and state the terms it just accepted. `retrySeconds` is null on an untimed
	// challenge (no clock to divide), and `oldFinal` is the score the retry will be
	// measured against — the number the modal must show BEFORE the click, and the
	// one the settlement books the difference from.
	resurrection?: {
		challengeId: string;
		retrySeconds: number | null;
		oldFinal: number;
		scoreMode: ResurrectionScoreMode;
	};
};

/**
 * Shield check for an incoming offensive effect (stuk 1). If the target team has
 * an active (non-consumed) shield in this set, claim it ATOMICALLY — the same
 * compare-and-swap pattern as the cumulative-highwater claim in awardPowerups —
 * and return blocked=true. The CAS closes the race where two teams attack the
 * same shielded target in the same instant: the first UPDATE flips consumed_at,
 * the second's `.is('consumed_at', null)` matches no row, so its attack applies.
 * The shield's own team_powerup is marked consumed so the pill drops.
 */
async function tryConsumeShield(
	supabase: SupabaseClient<Database>,
	targetTeamId: string,
	setId: string
): Promise<{ blocked: boolean }> {
	const { data: shield } = await supabase
		.from('team_effects')
		.select('id, source_team_powerup_id')
		.eq('team_id', targetTeamId)
		.eq('set_id', setId)
		.eq('effect_type', 'shield')
		.is('consumed_at', null)
		.limit(1)
		.maybeSingle();
	if (!shield) return { blocked: false };

	const { data: claimed } = await supabase
		.from('team_effects')
		.update({ consumed_at: new Date().toISOString() } as never)
		.eq('id', shield.id)
		.is('consumed_at', null)
		.select('id');
	// Lost the race (another attacker just burned this shield) → not blocked here.
	if (!claimed?.length) return { blocked: false };

	if (shield.source_team_powerup_id) {
		await supabase
			.from('team_powerups')
			.update({ status: 'consumed' } as never)
			.eq('id', shield.source_team_powerup_id);
	}
	return { blocked: true };
}

/**
 * Shared shield-block handling for an offensive activation (give_a_shot,
 * freeze, time_drain — same shape for all of them): inserts the pre-consumed
 * shield_block marker (the target's realtime notice), logs it, and marks the
 * CASTER's powerup consumed — attacking a shielded team still spends the
 * powerup. Returns the ActivateResult to hand straight back from the case.
 */
async function recordShieldBlock(
	supabase: SupabaseClient<Database>,
	params: {
		targetTeamId: string;
		setId: string;
		teamPowerupId: string;
		sourceTeamId: string;
		sourceName: string;
		blockedType: string;
	}
): Promise<ActivateResult> {
	const { targetTeamId, setId, teamPowerupId, sourceTeamId, sourceName, blockedType } = params;
	await supabase.from('team_effects').insert({
		team_id: targetTeamId,
		set_id: setId,
		effect_type: 'shield_block',
		payload: {
			blocked_type: blockedType,
			source_team_id: sourceTeamId,
			source_team_name: sourceName
		},
		consumed_at: new Date().toISOString(),
		source_team_powerup_id: teamPowerupId
	} as never);
	await supabase.from('activity_log').insert({
		team_id: targetTeamId,
		event_type: 'shield_block',
		payload: {
			blocked_type: blockedType,
			source_team_id: sourceTeamId,
			target_team_id: targetTeamId
		}
	} as never);
	await supabase
		.from('team_powerups')
		.update({ status: 'consumed' } as never)
		.eq('id', teamPowerupId);
	return { success: true, blocked: true };
}

/**
 * The target's most recently STARTED open timed attempt — the attempt a timer
 * attack (freeze/time_drain) actually hits. Unlike give_a_shot (activatable
 * anytime), timer effects need a live attempt to adjust — null means the
 * caller should reject the activation (design B: no apply-on-next-challenge).
 */
async function resolveTargetTimedAttempt(
	supabase: SupabaseClient<Database>,
	targetTeamId: string
): Promise<{ attemptId: string; challengeId: string } | null> {
	const { data: attempts } = await supabase
		.from('challenge_attempts')
		.select('id, challenge_id, started_at')
		.eq('team_id', targetTeamId)
		.is('ended_at', null)
		.order('started_at', { ascending: false });
	if (!attempts?.length) return null;

	const challengeIds = [...new Set(attempts.map((a) => a.challenge_id))];
	const { data: challenges } = await supabase
		.from('challenges')
		.select('id, timer_seconds')
		.in('id', challengeIds);
	const timedIds = new Set(
		(challenges ?? []).filter((c) => (c.timer_seconds ?? 0) > 0).map((c) => c.id)
	);

	const hit = attempts.find((a) => timedIds.has(a.challenge_id));
	return hit ? { attemptId: hit.id, challengeId: hit.challenge_id } : null;
}

/**
 * Batched version of the resolveTargetTimedAttempt predicate for the target
 * picker: which of `teamIds` currently have an open attempt on a timed
 * challenge. Two queries total for the whole set (not one per team) — the picker
 * greys the rest for freeze/time_drain. Same rule the per-team resolver enforces
 * server-side, so UI and activation agree.
 */
export async function getTeamsWithActiveTimedAttempt(
	supabase: SupabaseClient<Database>,
	teamIds: string[]
): Promise<Set<string>> {
	if (!teamIds.length) return new Set();
	const { data: attempts } = await supabase
		.from('challenge_attempts')
		.select('team_id, challenge_id')
		.in('team_id', teamIds)
		.is('ended_at', null);
	if (!attempts?.length) return new Set();

	const challengeIds = [...new Set(attempts.map((a) => a.challenge_id))];
	const { data: challenges } = await supabase
		.from('challenges')
		.select('id, timer_seconds')
		.in('id', challengeIds);
	const timedIds = new Set(
		(challenges ?? []).filter((c) => (c.timer_seconds ?? 0) > 0).map((c) => c.id)
	);

	const result = new Set<string>();
	for (const a of attempts) if (timedIds.has(a.challenge_id)) result.add(a.team_id);
	return result;
}

/**
 * Guard against stacking freeze (a STATE, unlike time_drain's arithmetic stack):
 * true if the target already has a freeze marker on this challenge whose 30s
 * window hasn't elapsed. Freeze rows are pre-consumed (same as time_boost), so
 * "still active" is derived from activated_at rather than consumed_at.
 */
async function hasActiveFreeze(
	supabase: SupabaseClient<Database>,
	targetTeamId: string,
	challengeId: string
): Promise<boolean> {
	const cutoff = new Date(Date.now() - 30_000).toISOString();
	const { data } = await supabase
		.from('team_effects')
		.select('payload')
		.eq('team_id', targetTeamId)
		.eq('effect_type', 'freeze')
		.gte('activated_at', cutoff);
	return (data ?? []).some(
		(r) => ((r.payload ?? {}) as { challenge_id?: string }).challenge_id === challengeId
	);
}

/**
 * Guard against stacking tap_to_break locks: true if the target already has a
 * non-consumed lock. Unlike freeze (time-windowed via activated_at), this row
 * has no natural expiry — it stays active until broken — so "still active" is
 * simply consumed_at IS NULL. A second lock while one is unbroken is rejected
 * (same STATE reasoning as freeze): stacking two rows the target would need to
 * clear independently serves no one.
 */
async function hasActiveTapLock(
	supabase: SupabaseClient<Database>,
	targetTeamId: string
): Promise<boolean> {
	const { data } = await supabase
		.from('team_effects')
		.select('id')
		.eq('team_id', targetTeamId)
		.eq('effect_type', 'tap_to_break')
		.is('consumed_at', null)
		.limit(1);
	return (data?.length ?? 0) > 0;
}

/**
 * Resolve the correct answer for ONE (tab, slot, field) triple — the free_answer
 * reveal.
 *
 * Replaces a hardcoded lookup that read the challenge's FIRST tab and that tab's
 * FIRST source track through a five-entry field→column map. That predated the
 * challenge-tabs model, so on a multi-tab challenge every tab revealed tab 1's
 * answer; on a multi-source tab (mashup / fragments) every slot revealed slot 1's;
 * `vocal_source` and any per-tab custom field revealed the empty string; and
 * mashup/fragments tabs (which have no challenge_tab_source_tracks row at all)
 * revealed nothing while still consuming the powerup.
 *
 * Both questions are now answered by the SAME resolvers the scoring pipeline uses:
 *   - resolveTabFields  → does this tab actually have this field (C3b overrides)
 *   - getSourceTracksForTab → which track sits behind slot N of this tab, with the
 *     mashup (via mashup_sources) and fragments (derived from ordered clips) cases
 *     already handled inside it
 *   - correctValueForField → the exact string the results screen calls `correct`
 * so a reveal cannot disagree with what the scorer accepts.
 *
 * Returns an `error` rather than a value whenever the answer would be ambiguous,
 * absent or empty. The caller then FAILS the activation and leaves the powerup
 * held — burning a one-shot powerup on a blank reveal is the worse outcome, and
 * showing a confidently wrong answer is worse still.
 *
 * Loads only the requested tab's rows (not the whole challenge like the submit
 * pipeline does) — a reveal needs exactly one track.
 *
 * Exported for verification: it performs SELECTs only, so a read-only probe can
 * drive it against real challenges (see scripts/probe-free-answer.ts style usage
 * in the report) without writing anything.
 */
export async function resolveFreeAnswerValue(
	supabase: SupabaseClient<Database>,
	challengeId: string,
	field: string,
	tabId: string | null,
	slotIndex: number
): Promise<
	{ value: string; tags?: string[]; tabId: string; slotIndex: number } | { error: string }
> {
	const fieldLabel = field.replace(/_/g, ' ');

	const { data: challenge } = await supabase
		.from('challenges')
		.select('variant, points_config')
		.eq('id', challengeId)
		.maybeSingle();
	if (!challenge) return { error: 'Challenge not found' };
	const variant = challenge.variant as string;

	const { data: tabRows } = await supabase
		.from('challenge_tabs')
		.select('*')
		.eq('challenge_id', challengeId)
		.order('position');
	const tabs = (tabRows ?? []) as Array<{
		id: string;
		position: number;
		mashup_id?: string | null;
		fields?: unknown;
	}>;
	if (!tabs.length) return { error: 'This challenge has no tabs configured' };

	// No tab supplied → only unambiguous on a single-tab challenge. With more tabs
	// we refuse instead of silently falling back to tab 1 (exactly the old bug).
	if (tabId === null && tabs.length > 1)
		return { error: 'Open the tab you want revealed, then activate again' };
	// Matched by uuid, so a challenge with repeated `position` values (they exist)
	// still resolves to the exact tab the player is on.
	const tab = tabId === null ? tabs[0] : tabs.find((t) => t.id === tabId);
	if (!tab) return { error: 'That tab is no longer part of this challenge' };

	// `grouping` WORDT hier wel opgelost, anders dan voorheen. De oude weigering
	// ("scored across the whole tab, no single value") klopte niet: scoreTab scoort
	// grouping PER SLOT, tegen de fragmentnummers van de track die aan dat slot
	// gematcht wordt. Er is dus wel degelijk één antwoord per (tab, slot), en dat
	// is precies wat een team dat Gratis Tab of Gratis Antwoord op een
	// fragments-challenge inzet nodig heeft — zonder de clipnummers is het
	// antwoord voor die track niet compleet. Het antwoord zelf komt uit
	// groupingAnswerForTrack (scoring.ts), dezelfde functie die het resultaatscherm
	// vult, dus de onthulling kan niet afwijken van wat er gescoord wordt.
	// De oplossing staat verderop, na het laden van de clips en de bron-tracks.

	const { data: vdRow } = await supabase
		.from('variant_defaults')
		.select('points_config')
		.eq('variant', variant)
		.maybeSingle();
	const variantDefaultPoints = ((vdRow?.points_config as Record<string, unknown> | null)
		?.field_points ?? {}) as Record<string, number>;

	const { fields: tabFields } = fieldMapsFromResolved(
		resolveTabFields(tab, { variant, points_config: challenge.points_config }, variantDefaultPoints)
	);
	if (!tabFields.includes(field as AnswerField))
		return { error: `This tab has no ${fieldLabel} field` };

	const [srcRes, tabClipRes] = await Promise.all([
		supabase
			.from('challenge_tab_source_tracks')
			.select('*')
			.eq('tab_id', tab.id)
			.order('sort_order'),
		supabase.from('challenge_tab_clips').select('*').eq('tab_id', tab.id).order('sort_order')
	]);
	const sourceTrackRows = (srcRes.data ?? []) as TabSourceTrackRaw[];
	const tabClipRows = tabClipRes.data ?? [];

	// Fragments derives its source tracks from the clips, so clips load first.
	const clipIds = [...new Set(tabClipRows.map((c) => c.clip_id))];
	const clipsRes = await (clipIds.length
		? supabase.from('clips').select('id, track_id').in('id', clipIds)
		: Promise.resolve({ data: [] as { id: string; track_id: string }[] }));
	const clips: ClipRaw[] = (clipsRes.data ?? []).map((c) => ({ id: c.id, track_id: c.track_id }));

	const mashupId = tab.mashup_id ?? null;
	const mashupRes = await (variant === 'mashup' && mashupId
		? supabase.from('mashup_sources').select('*').eq('mashup_id', mashupId).order('sort_order')
		: Promise.resolve({ data: [] as MashupSourceRaw[] }));
	const mashupSources: MashupSourceRaw[] = (mashupRes.data ?? []).map((r) => ({
		id: r.id,
		mashup_id: r.mashup_id,
		track_id: r.track_id,
		sort_order: r.sort_order
	}));

	const trackIds = [
		...new Set(
			[
				...sourceTrackRows.map((s) => s.track_id),
				...mashupSources.map((s) => s.track_id),
				...clips.map((c) => c.track_id)
			].filter(Boolean)
		)
	];
	const tracksRes = await (trackIds.length
		? supabase.from('tracks').select('*').in('id', trackIds)
		: Promise.resolve({ data: [] as unknown[] }));
	const trackMap = new Map(
		((tracksRes.data ?? []) as unknown as TrackData[]).map((t) => [t.id, t])
	);

	const tabClipData: TabClipData[] = tabClipRows.map((c) => ({
		id: c.id,
		tabId: c.tab_id,
		clipId: c.clip_id,
		fragmentNumber: c.fragment_number,
		sortOrder: c.sort_order,
		trackId: clips.find((cl) => cl.id === c.clip_id)?.track_id
	}));

	const sources = getSourceTracksForTab(
		variant,
		{ id: tab.id, mashup_id: mashupId },
		sourceTrackRows,
		mashupSources,
		tabClipData,
		clips,
		trackMap
	);
	if (!sources.length) return { error: 'This tab has no track behind it yet — nothing to reveal' };

	const slot = sources[slotIndex];
	if (!slot) return { error: 'That answer slot no longer exists on this tab' };

	if (field === 'grouping') {
		// Geen correctValueForField: die krijgt alleen een track mee en het antwoord
		// hangt af van de clips van DEZE tab. Zie groupingAnswerForTrack.
		const nums = groupingAnswerForTrack(tabClipData, slot.trackId);
		if (!nums) return { error: 'Deze track heeft geen genummerde fragmenten — niets te onthullen' };
		return { value: nums, tabId: tab.id, slotIndex };
	}

	const value = correctValueForField(field as AnswerField, slot.track);
	// A misconfigured track (empty column) would otherwise reveal '' and still burn
	// the powerup — the exact silent failure the old lookup had for vocal_source.
	if (!value.trim())
		return { error: `This track has no ${fieldLabel} on file — nothing to reveal` };

	// The artist answer is a TAG LIST, not a string, and the client cannot derive
	// the tags from `value`: artistTargets joins with ' & ', and a track whose
	// artists[] is ['D-Block & S-te-Fan'] produces a string byte-identical in shape
	// to one whose artists[] is ['Rooler','Sefa']. Splitting client-side would be
	// right for the second and wrong for the first — the exact trap $lib/artist-tags
	// documents. So the targets travel alongside the display string; `value` itself
	// is unchanged, and every caller that only wants text keeps working.
	const tags = field === 'artist' ? artistTargets(slot.track) : undefined;

	return { value, ...(tags?.length ? { tags } : {}), tabId: tab.id, slotIndex };
}

// ─── lifeline: the time gate ─────────────────────────────────────────────────

/**
 * How far into its challenge clock is a team's open attempt?
 *
 * The first TIME-based activation gate in the powerup system, so it is worth
 * being explicit about which clock it reads. The deadline a team is actually
 * racing is not `started_at + timer_seconds`: time_boost, freeze and time_drain
 * each insert a marker row carrying { added_seconds, challenge_id }, and
 * /api/auto-submit SUMS those into the deadline it enforces. This function
 * reproduces that same sum, so "half the clock has gone" means half of the clock
 * the team is really playing against — not half of a nominal one that a boost
 * has already made wrong.
 *
 * Everything here is server-side and derived from stored timestamps. The client
 * countdown is never an input: a tampered or merely drifting phone clock cannot
 * open this gate early.
 *
 * Returns null when there is nothing to measure — no open attempt, or an untimed
 * challenge — and the caller turns that into a refusal, because an untimed
 * challenge has no halfway point at all (the same reason time_boost refuses one).
 */
export async function attemptElapsedFraction(
	supabase: SupabaseClient<Database>,
	challengeId: string,
	teamId: string,
	now: number = Date.now()
): Promise<{ fraction: number; totalSeconds: number } | null> {
	const { data: attempt } = await supabase
		.from('challenge_attempts')
		.select('started_at')
		.eq('challenge_id', challengeId)
		.eq('team_id', teamId)
		.is('ended_at', null)
		.maybeSingle();
	if (!attempt?.started_at) return null;

	const { data: ch } = await supabase
		.from('challenges')
		.select('timer_seconds')
		.eq('id', challengeId)
		.maybeSingle();
	const baseSeconds = ch?.timer_seconds ?? 0;
	if (baseSeconds <= 0) return null;

	// The same three effect types, the same payload key and the same summation as
	// /api/auto-submit — a boost that moved the deadline must move this gate too,
	// or the two would disagree about how long the challenge is.
	const { data: boostRows } = await supabase
		.from('team_effects')
		.select('payload')
		.eq('team_id', teamId)
		.in('effect_type', ['time_boost', 'freeze', 'time_drain']);
	let boost = 0;
	for (const row of boostRows ?? []) {
		const p = (row.payload ?? {}) as { added_seconds?: number; challenge_id?: string };
		if (p.challenge_id !== challengeId) continue;
		if (typeof p.added_seconds === 'number' && Number.isFinite(p.added_seconds)) {
			boost += p.added_seconds;
		}
	}

	// A drain deep enough to take the total to zero or below leaves no clock to be
	// halfway through. Refuse rather than divide by it.
	const totalSeconds = baseSeconds + boost;
	if (totalSeconds <= 0) return null;

	const elapsedMs = now - new Date(attempt.started_at).getTime();
	return { fraction: elapsedMs / (totalSeconds * 1000), totalSeconds };
}

// ─── lifeline: the hints ─────────────────────────────────────────────────────

/**
 * Build the masked hints for one challenge, given the team's current draft.
 *
 * Two things happen per cell, and both delegate:
 *   - the correct answer comes from correctValueForField (scoring.ts), the same
 *     function the results screen and every reveal powerup use;
 *   - "has the team already got this right" comes from fieldIsFullyCorrect
 *     (scoring.ts), which runs the real scoreField.
 * Neither notion is re-implemented here. What lives here is only the sweep:
 * every tab, every slot, every field, and the masking of what comes back.
 *
 * WHY THIS LOADS THE CHALLENGE ITSELF instead of calling resolveFreeAnswerValue
 * per cell like free_tab does: that helper re-loads the challenge, its tabs, the
 * variant defaults, the sources, the clips and the tracks on EVERY call, which
 * is fine for one reveal or a handful, and is roughly sixty round trips for a
 * three-tab challenge swept exhaustively. So the load happens once, whole-
 * challenge, and mirrors resolveFreeAnswerValue's per-tab load step for step.
 * The parts that carry meaning — which tracks a tab resolves to, which fields it
 * has, what the correct value is — are the same shared helpers in both.
 *
 * The draft is keyed by String(tab.position), the exact shape the submit path
 * uses (draftByTab in src/lib/server/submit.ts), so the answers this reads are
 * the answers that would be scored. It arrives from the client and is therefore
 * a CLAIM, not a fact — a team that sends an empty draft simply gets hints on
 * every field, which is strictly less information than the correct/incorrect
 * split it would otherwise see. Nothing is trusted beyond "this is what you told
 * us you typed".
 *
 * A cell yields no hint when it is already fully correct, when the field has no
 * revealable answer (grouping), or when the track's column is empty — the same
 * "nothing to reveal" case resolveFreeAnswerValue refuses on.
 *
 * Exported for verification: SELECTs only, no writes.
 */
export async function resolveLifelineHints(
	supabase: SupabaseClient<Database>,
	challengeId: string,
	draftByTab: Record<string, SlotDraft[]>
): Promise<{ hints: LifelineHint[] } | { error: string }> {
	const { data: challenge } = await supabase
		.from('challenges')
		.select('variant, points_config')
		.eq('id', challengeId)
		.maybeSingle();
	if (!challenge) return { error: 'Challenge not found' };
	const variant = challenge.variant as string;
	const pointsConfig = challenge.points_config;
	const artistBonus = resolveArtistBonus(pointsConfig);

	const { data: tabRows } = await supabase
		.from('challenge_tabs')
		.select('*')
		.eq('challenge_id', challengeId)
		.order('position');
	const tabs = (tabRows ?? []) as Array<{
		id: string;
		position: number;
		mashup_id?: string | null;
		fields?: unknown;
	}>;
	if (!tabs.length) return { error: 'This challenge has no tabs configured' };
	const tabIds = tabs.map((t) => t.id);

	const { data: vdRow } = await supabase
		.from('variant_defaults')
		.select('points_config')
		.eq('variant', variant)
		.maybeSingle();
	const variantDefaultPoints = ((vdRow?.points_config as Record<string, unknown> | null)
		?.field_points ?? {}) as Record<string, number>;

	const [srcRes, tabClipRes] = await Promise.all([
		supabase
			.from('challenge_tab_source_tracks')
			.select('*')
			.in('tab_id', tabIds)
			.order('sort_order'),
		supabase.from('challenge_tab_clips').select('*').in('tab_id', tabIds).order('sort_order')
	]);
	const sourceTrackRows = (srcRes.data ?? []) as TabSourceTrackRaw[];
	const tabClipRows = tabClipRes.data ?? [];

	// Fragments derives its source tracks from the clips, so clips load first.
	const clipIds = [...new Set(tabClipRows.map((c) => c.clip_id))];
	const clipsRes = await (clipIds.length
		? supabase.from('clips').select('id, track_id').in('id', clipIds)
		: Promise.resolve({ data: [] as { id: string; track_id: string }[] }));
	const clips: ClipRaw[] = (clipsRes.data ?? []).map((c) => ({ id: c.id, track_id: c.track_id }));

	const mashupIds =
		variant === 'mashup'
			? [...new Set(tabs.map((t) => t.mashup_id).filter((id): id is string => !!id))]
			: [];
	const mashupRes = await (mashupIds.length
		? supabase.from('mashup_sources').select('*').in('mashup_id', mashupIds).order('sort_order')
		: Promise.resolve({ data: [] as MashupSourceRaw[] }));
	const mashupSources: MashupSourceRaw[] = (mashupRes.data ?? []).map((r) => ({
		id: r.id,
		mashup_id: r.mashup_id,
		track_id: r.track_id,
		sort_order: r.sort_order
	}));

	const trackIds = [
		...new Set(
			[
				...sourceTrackRows.map((s) => s.track_id),
				...mashupSources.map((s) => s.track_id),
				...clips.map((c) => c.track_id)
			].filter(Boolean)
		)
	];
	const tracksRes = await (trackIds.length
		? supabase.from('tracks').select('*').in('id', trackIds)
		: Promise.resolve({ data: [] as unknown[] }));
	const trackMap = new Map(
		((tracksRes.data ?? []) as unknown as TrackData[]).map((t) => [t.id, t])
	);

	const allTabClipData: TabClipData[] = tabClipRows.map((c) => ({
		id: c.id,
		tabId: c.tab_id,
		clipId: c.clip_id,
		fragmentNumber: c.fragment_number,
		sortOrder: c.sort_order,
		trackId: clips.find((cl) => cl.id === c.clip_id)?.track_id
	}));

	const hints: LifelineHint[] = [];

	for (const tab of tabs) {
		// This tab's OWN resolved fields/modes/points — resolveTabFields, the same
		// resolver the submit path and every reveal use, so a per-tab field override
		// is honoured here exactly as it is when the answer is scored.
		// bonusFields is deliberately not read: whether a field is a bonus one changes
		// how it counts towards the threshold, not whether the team has it right.
		const { fields, fieldModes, fieldPoints } = fieldMapsFromResolved(
			resolveTabFields(tab, { variant, points_config: pointsConfig }, variantDefaultPoints)
		);

		const sources = getSourceTracksForTab(
			variant,
			{ id: tab.id, mashup_id: tab.mashup_id ?? null },
			sourceTrackRows,
			mashupSources,
			allTabClipData,
			clips,
			trackMap
		);
		// A tab with no track behind it (an unfinished mashup, an empty slot) has no
		// answers to hint at. Skipped, not fatal — the other tabs still produce hints,
		// the same posture free_tab takes towards a cell it cannot resolve.
		if (!sources.length) continue;

		const tabDraft = draftByTab[String(tab.position)] ?? [];

		for (let slotIndex = 0; slotIndex < sources.length; slotIndex++) {
			const track = sources[slotIndex].track;
			if (!track) continue;
			const slotDraft = tabDraft[slotIndex];

			for (const field of fields) {
				// grouping is scored across the whole tab, not per track — no single
				// answer exists to mask. Excluded here exactly as every reveal excludes it.
				if (field === 'grouping') continue;

				const correct = correctValueForField(field, track);
				// An empty column on the track: nothing to mask. Silently skipped rather
				// than emitting a hint of "" that would render as an empty line.
				if (!correct.trim()) continue;

				const submitted = slotDraft?.fieldValues?.[field] ?? '';
				const mode = (fieldModes[field] ?? 'open_text') as InputMode;
				const maxPoints = fieldPoints[field] ?? 0;

				if (fieldIsFullyCorrect(field, submitted, track, mode, maxPoints, artistBonus)) continue;

				hints.push({
					tabId: tab.id,
					slotIndex,
					field: String(field),
					mask: maskAnswer(correct)
				});
			}
		}
	}

	return { hints };
}

// ─── x_ray: spending one reveal from the budget ──────────────────────────────

export type SpendXrayResult =
	| { success: true; reveal: RevealResult; remaining: number }
	| { success: false; error: string };

/**
 * Spend ONE reveal from a team's running X-Ray budget.
 *
 * This is the whole of X-Ray's per-field mechanic, and it deliberately owns none
 * of the reveal itself: `resolveReveal` defaults to resolveFreeAnswerValue — the
 * same function free_answer, free_tab and the original x_ray all go through — and
 * the row it writes is the same effect_type='free_answer' row the challenge page
 * already reads back. What lives here is only the budget: find it, refuse without
 * it, decrement it, and end the powerup when it runs out.
 *
 * Order matters, and it is: resolve FIRST, decrement only on success. A cell that
 * cannot be revealed (mashup tab with no track, `grouping`, an empty column) must
 * cost nothing — the same "never charge for nothing" rule free_answer applies by
 * staying held.
 *
 * The decrement is a compare-and-swap on the counter's current value (the same
 * pattern tryConsumeShield and the cumulative-highwater claim use), so two taps
 * landing at once cannot both spend the same unit: the second finds the counter
 * already moved and is told to try again.
 *
 * `resolveReveal` is injectable for the same reason rollDice's `rand` is — the
 * budget behaviour can then be asserted without a database. Production never
 * passes it.
 */
export async function spendXrayReveal(
	supabase: SupabaseClient<Database>,
	params: {
		teamId: string;
		challengeId: string;
		field: string;
		tabId: string | null;
		slotIndex: number;
	},
	deps?: { resolveReveal?: typeof resolveFreeAnswerValue }
): Promise<SpendXrayResult> {
	const resolveReveal = deps?.resolveReveal ?? resolveFreeAnswerValue;

	// The running budget. Same criterion the banner shows it by — team_id +
	// consumed_at IS NULL (loadActiveEffects adds set_id, which only narrows it), so
	// anything the banner displays is findable here.
	//
	// Ordered by activated_at, NOT created_at: team_effects has no created_at column
	// (0044_powerups_runtime.sql — id, team_id, set_id, effect_type, payload,
	// activated_at, expires_at, consumed_at, consumed_challenge_id, plus 0047's
	// source_team_powerup_id). PostgREST rejects the whole query on an unknown sort
	// column, which returned data=null and read as "no effect" — the banner, which
	// never sorts, kept showing the very row this could not find.
	const { data: effect, error: lookupErr } = await supabase
		.from('team_effects')
		.select('id, set_id, payload, source_team_powerup_id')
		.eq('team_id', params.teamId)
		.eq('effect_type', 'x_ray')
		.is('consumed_at', null)
		.order('activated_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	// A failed QUERY is not the same as no budget, and conflating the two is what
	// made the bug above so hard to read from the UI. Surface it as its own message.
	if (lookupErr) return { success: false, error: `X-Ray lookup failed: ${lookupErr.message}` };
	if (!effect) return { success: false, error: 'No X-Ray running' };

	const payload = (effect.payload ?? {}) as Record<string, unknown>;
	const remaining = typeof payload.reveals_remaining === 'number' ? payload.reveals_remaining : 0;
	if (remaining <= 0) return { success: false, error: 'No X-Ray reveals left' };

	// Same gate free_answer puts on its reveal: you can only uncover an answer on a
	// challenge you are actually playing.
	const { data: attempt } = await supabase
		.from('challenge_attempts')
		.select('id')
		.eq('challenge_id', params.challengeId)
		.eq('team_id', params.teamId)
		.is('ended_at', null)
		.maybeSingle();
	if (!attempt) return { success: false, error: 'No active attempt for this challenge' };

	const resolved = await resolveReveal(
		supabase,
		params.challengeId,
		params.field,
		params.tabId,
		params.slotIndex
	);
	// Refused: nothing written, nothing charged, budget untouched.
	if ('error' in resolved) return { success: false, error: resolved.error };

	// CAS: only decrement if the counter still reads what we resolved against.
	const { data: claimed } = await supabase
		.from('team_effects')
		.update({ payload: { ...payload, reveals_remaining: remaining - 1 } } as never)
		.eq('id', effect.id)
		.eq('payload->>reveals_remaining', String(remaining))
		.select('id');
	if (!claimed?.length) return { success: false, error: 'X-Ray busy — try that again' };

	const reveal: RevealResult = {
		value: resolved.value,
		...(resolved.tags?.length ? { tags: resolved.tags } : {}),
		field: params.field,
		tabId: resolved.tabId,
		slotIndex: resolved.slotIndex
	};

	// The reveal itself, stored exactly as free_answer stores one — which is what
	// makes it survive a refresh (the challenge load rebuilds every consumed
	// free_answer row for this challenge) with no extra persistence.
	await supabase.from('team_effects').insert({
		team_id: params.teamId,
		set_id: effect.set_id,
		effect_type: 'free_answer',
		payload: {
			field: params.field,
			value: resolved.value,
			challenge_id: params.challengeId,
			tab_id: resolved.tabId,
			slot_index: resolved.slotIndex,
			source: 'x_ray'
		},
		consumed_at: new Date().toISOString(),
		consumed_challenge_id: params.challengeId,
		source_team_powerup_id: effect.source_team_powerup_id
	} as never);

	const nowRemaining = remaining - 1;
	// Spent out: the budget row closes and the powerup is finally consumed — NOT
	// after the first reveal, which is what the previous version did.
	if (nowRemaining === 0) {
		await supabase
			.from('team_effects')
			.update({ consumed_at: new Date().toISOString() } as never)
			.eq('id', effect.id)
			.is('consumed_at', null);
		if (effect.source_team_powerup_id) {
			await supabase
				.from('team_powerups')
				.update({ status: 'consumed' } as never)
				.eq('id', effect.source_team_powerup_id);
		}
	}

	return { success: true, reveal, remaining: nowRemaining };
}

/**
 * Activate a held powerup. Creates a team_effects row and transitions status.
 * Commit 1 handles: bonus_points, single_event_mult, hard_gaan, shield.
 * Commit 2 adds: free_answer, time_boost, insurance.
 */
export async function activatePowerup(
	supabase: SupabaseClient<Database>,
	teamPowerupId: string,
	options?: ActivateOptions
): Promise<ActivateResult> {
	// 1. Fetch team_powerup + type
	const { data: tpu } = await supabase
		.from('team_powerups')
		.select('*')
		.eq('id', teamPowerupId)
		.maybeSingle();

	const statusOk =
		tpu?.status === 'held' || (options?.allowFromPending && tpu?.status === 'pending');
	if (!tpu || !statusOk) return { success: false, error: 'Powerup not in held state' };

	if (!tpu.set_id) return { success: false, error: 'Powerup has no set_id' };

	const { data: powerupType } = await supabase
		.from('powerup_types')
		.select('*')
		.eq('id', tpu.powerup_type_id)
		.maybeSingle();

	if (!powerupType) return { success: false, error: 'Powerup type not found' };

	// 2. Validate set is active
	const { data: gameSet } = await supabase
		.from('game_sets')
		.select('status, play_state, hard_gaan_window_minutes, powerup_config')
		.eq('id', tpu.set_id)
		.maybeSingle();

	if (!gameSet || gameSet.status !== 'active')
		return { success: false, error: 'Game set is not active' };

	const typeId = powerupType.id;

	// 3. Type-specific activation
	switch (typeId) {
		case 'bonus_points': {
			// 5, not 15: powerup_types.description promises "+5 points to your team
			// immediately" (seeded in 0044) and the card is what the team reads.
			const payload = { value: 5 };
			const { data: eff, error } = await supabase
				.from('team_effects')
				.insert({
					team_id: tpu.team_id,
					set_id: tpu.set_id,
					effect_type: 'bonus_points',
					payload,
					source_team_powerup_id: teamPowerupId
				} as never)
				.select('id')
				.single();
			if (error) return { success: false, error: error.message };
			await supabase
				.from('team_powerups')
				.update({ status: 'active' } as never)
				.eq('id', teamPowerupId);
			return { success: true, effectId: eff.id, payload };
		}

		case 'lucky_dice': {
			// INSTANT, not a pending effect. The roll lands on teams.score the moment it
			// is rolled — no team_effects row waiting for the next submission (which is
			// what the first version did, and what made the modal promise "+N next
			// submission" instead of points the team could already see).
			//
			// The direct-score path is the one the other non-scoring point mutations
			// use: read the current score, write score + delta, log the mutation to
			// activity_log. Same three steps as awardCrownPayout (src/lib/server/crown.ts)
			// and the host's manual adjustment (src/routes/admin/teams/+page.server.ts,
			// ?/adjustScore). /team and /leaderboard already subscribe to teams UPDATEs,
			// so the new total appears there without anything extra here.
			//
			// Range from the set's config (never hardcoded here); randomness from the
			// one injectable roll function, so a test can pin both ends.
			const { min, max } = resolveDiceRange(
				parseConfig((gameSet as unknown as { powerup_config?: unknown }).powerup_config)
			);
			const roll = rollDice(min, max, options?.rand);

			const { data: team } = await supabase
				.from('teams')
				.select('score')
				.eq('id', tpu.team_id)
				.maybeSingle();
			if (!team) return { success: false, error: 'Team not found' };
			const oldScore = team.score ?? 0;
			const newScore = oldScore + roll;

			const { error: scoreErr } = await supabase
				.from('teams')
				.update({ score: newScore })
				.eq('id', tpu.team_id);
			if (scoreErr) return { success: false, error: scoreErr.message };

			await supabase.from('activity_log').insert({
				team_id: tpu.team_id,
				event_type: 'lucky_dice',
				payload: {
					roll,
					dice_min: min,
					dice_max: max,
					old_score: oldScore,
					new_score: newScore
				}
			} as never);

			// A score that moves in-play has to keep the crown honest — the same call
			// scoreAndPersistSubmission makes after every submission total
			// (src/lib/server/submit.ts). Its own guards do the deciding: no-op if this
			// team already holds the crown, transfer + 1 steal bonus only on a STRICT
			// overtake. Without this a dice roll could put a team in the lead while the
			// crown stayed on the wrong team.
			await maybeTransferCrown(supabase, tpu.set_id, tpu.team_id, newScore);

			await supabase
				.from('team_powerups')
				.update({ status: 'consumed' } as never)
				.eq('id', teamPowerupId);

			// No effect row, so nothing to consume later — `consumed` straight away, the
			// same terminal status penalty_shot uses for its no-effect-row activation.
			return {
				success: true,
				payload: { value: roll, dice_min: min, dice_max: max, new_score: newScore }
			};
		}

		case 'power_spin': {
			// The first powerup that awards ANOTHER powerup.
			//
			// Power Spin deliberately implements almost nothing itself: it rolls a
			// type and hands it to materializeAward() — the very function the earning
			// ladder calls — so the rolled powerup follows ITS OWN nature. An
			// immediate-use result fires at once (materializeAward auto-activates it),
			// a holdable one lands as 'pending' and gets its normal store/lose card, a
			// targeted one gets its target picker. None of that is re-implemented here,
			// which is what makes a spun powerup indistinguishable from an earned one.
			//
			// Recursion is closed off in the POOL, not by a special case in the award
			// path: spinPoolForTier subtracts SPIN_EXCLUDED_TYPE_IDS, which holds
			// power_spin itself (it is Tier A, so the wheel could otherwise land on
			// itself) plus any future type that also awards powerups. With that filter
			// the chain is at most materializeAward -> activatePowerup(power_spin) ->
			// materializeAward -> activatePowerup(rolled) -> terminates.
			const spinCfg = parseConfig(
				(gameSet as unknown as { powerup_config?: unknown }).powerup_config
			);
			const { data: spinTypes } = await supabase.from('powerup_types').select('*');

			// Randomness from the injectable source, exactly like lucky_dice's roll, so
			// a verification run can pin both the tier draw and the pick.
			const pick = pickSpinType(spinCfg, (spinTypes ?? []) as PowerupType[], options?.rand);

			// Empty wheel: every tier in the chain had no eligible member (a host would
			// have to have disabled all of Tier A, since Tier S being empty just falls
			// back). Consume rather than fail — a failed activation leaves the row on
			// 'pending', which is a powerup the team owns but can never reach again.
			if (!pick.type) {
				await supabase
					.from('team_powerups')
					.update({ status: 'consumed' } as never)
					.eq('id', teamPowerupId);
				return {
					success: true,
					payload: {
						rolled_tier: pick.rolledTier,
						used_tier: null,
						rolled_type_id: null,
						rolled_type_name: null
					}
				};
			}

			// Same set, and the same challenge this spin was granted from (nullable —
			// a spin earned outside a challenge simply passes null along).
			const spun = await materializeAward(
				supabase,
				tpu.team_id,
				tpu.set_id,
				tpu.granted_from_challenge_id,
				pick.type
			);
			if (!spun) {
				// The insert failed. Consume the spin anyway so it doesn't strand on
				// 'pending', and report honestly instead of pretending something landed.
				await supabase
					.from('team_powerups')
					.update({ status: 'consumed' } as never)
					.eq('id', teamPowerupId);
				return { success: false, error: 'Spin could not award a powerup' };
			}

			await supabase.from('activity_log').insert({
				team_id: tpu.team_id,
				event_type: 'power_spin',
				payload: {
					rolled_tier: pick.rolledTier,
					used_tier: pick.usedTier,
					rolled_type_id: pick.type.id,
					awarded_team_powerup_id: spun.teamPowerupId
				}
			} as never);

			await supabase
				.from('team_powerups')
				.update({ status: 'consumed' } as never)
				.eq('id', teamPowerupId);

			return {
				success: true,
				spun,
				payload: {
					rolled_tier: pick.rolledTier,
					used_tier: pick.usedTier,
					rolled_type_id: pick.type.id,
					rolled_type_name: pick.type.name,
					rolled_type_icon: pick.type.icon
				}
			};
		}

		case 'single_event_mult': {
			// The card promises a ROLL — "Random multiplier (x1.2/x1.4/x1.6)" — so a
			// fixed 1.5 was a broken promise however plausible the number. Randomness
			// from the one injectable roll function, like lucky_dice's; the rolled
			// value goes into the payload, which is what deriveEffectModifiers reads
			// back (powerups.ts:1051) and what computeBreakdown folds into the
			// additive-delta sum. Nothing downstream assumes a multiplier.
			const payload = { multiplier: rollSingleEventMult(options?.rand) };
			const { data: eff, error } = await supabase
				.from('team_effects')
				.insert({
					team_id: tpu.team_id,
					set_id: tpu.set_id,
					effect_type: 'single_event_mult',
					payload,
					source_team_powerup_id: teamPowerupId
				} as never)
				.select('id')
				.single();
			if (error) return { success: false, error: error.message };
			await supabase
				.from('team_powerups')
				.update({ status: 'active' } as never)
				.eq('id', teamPowerupId);
			return { success: true, effectId: eff.id, payload };
		}

		case 'hard_gaan': {
			const windowMinutes =
				(gameSet as unknown as { hard_gaan_window_minutes?: number }).hard_gaan_window_minutes ??
				15;
			const expiresAt = new Date(Date.now() + windowMinutes * 60 * 1000).toISOString();
			const payload = { multiplier: 1.5, window_minutes: windowMinutes };
			const { data: eff, error } = await supabase
				.from('team_effects')
				.insert({
					team_id: tpu.team_id,
					set_id: tpu.set_id,
					effect_type: 'hard_gaan',
					payload,
					expires_at: expiresAt,
					source_team_powerup_id: teamPowerupId
				} as never)
				.select('id')
				.single();
			if (error) return { success: false, error: error.message };
			await supabase
				.from('team_powerups')
				.update({ status: 'active' } as never)
				.eq('id', teamPowerupId);
			return { success: true, effectId: eff.id, payload };
		}

		case 'shield': {
			// Guard C: only one shield up at a time. A second activation is rejected
			// and the powerup stays held (status unchanged).
			const { data: existingShield } = await supabase
				.from('team_effects')
				.select('id')
				.eq('team_id', tpu.team_id)
				.eq('set_id', tpu.set_id)
				.eq('effect_type', 'shield')
				.is('consumed_at', null)
				.limit(1)
				.maybeSingle();
			if (existingShield) return { success: false, error: 'Shield already up' };

			const { data: eff, error } = await supabase
				.from('team_effects')
				.insert({
					team_id: tpu.team_id,
					set_id: tpu.set_id,
					effect_type: 'shield',
					payload: {},
					source_team_powerup_id: teamPowerupId
				} as never)
				.select('id')
				.single();
			if (error) return { success: false, error: error.message };
			await supabase
				.from('team_powerups')
				.update({ status: 'active' } as never)
				.eq('id', teamPowerupId);
			return { success: true, effectId: eff.id };
		}

		case 'double_down': {
			// ── Guard 1: the prediction must be a whole 0–100 percentage ───────────
			// Everything downstream (the ±g/100 delta, the banner copy, the result
			// pill) assumes this range, so it is validated at the only door into the
			// system rather than defended at each read site.
			const predicted = options?.predictedPct;
			if (
				typeof predicted !== 'number' ||
				!Number.isFinite(predicted) ||
				!Number.isInteger(predicted) ||
				predicted < 0 ||
				predicted > 100
			) {
				return { success: false, error: 'Double Down needs a prediction between 0 and 100' };
			}

			// ── Guard 2: before the challenge starts, never during ─────────────────
			// The bet has to be blind. Once a team has started an attempt it has heard
			// the audio and knows roughly how it will score, so a late activation is a
			// free win. hard_gaan is NOT the precedent for this (it is a time-window
			// effect with no attempt lookup at all); the shape below is time_boost's
			// challenge_attempts lookup (case 'time_boost') inverted — it requires an
			// open attempt, this one requires the absence of one.
			//
			// Scoped to the challenges of THIS set: challenge_attempts has no set_id,
			// and an unscoped query would let an abandoned attempt from an earlier set
			// block activation forever. Within a set that residual risk remains for an
			// UNTIMED challenge a team started and never submitted (a timed one is
			// closed by /api/auto-submit) — the team would have to finish or the host
			// to clear the attempt.
			const { data: setChallengeRows } = await supabase
				.from('set_challenges')
				.select('challenge_id')
				.eq('set_id', tpu.set_id);
			const setChallengeIds = (setChallengeRows ?? []).map((r) => r.challenge_id);
			if (setChallengeIds.length > 0) {
				const { data: openAttempt } = await supabase
					.from('challenge_attempts')
					.select('id')
					.eq('team_id', tpu.team_id)
					.in('challenge_id', setChallengeIds)
					.is('ended_at', null)
					.limit(1)
					.maybeSingle();
				if (openAttempt)
					return {
						success: false,
						error: 'Double Down must be activated before a challenge starts'
					};
			}

			// ── Guard 3: one bet at a time ─────────────────────────────────────────
			// Two live Double Downs would put two conditional deltas in the same sum
			// with no way for a team to reason about the outcome. Same one-at-a-time
			// rule (and same rejection-keeps-it-held behaviour) as shield above.
			const { data: existingBet } = await supabase
				.from('team_effects')
				.select('id')
				.eq('team_id', tpu.team_id)
				.eq('set_id', tpu.set_id)
				.eq('effect_type', 'double_down')
				.is('consumed_at', null)
				.limit(1)
				.maybeSingle();
			if (existingBet) return { success: false, error: 'A Double Down is already running' };

			// No expires_at: the bet rides until the next submission consumes it, the
			// same lifetime single_event_mult has.
			const payload = { predicted_pct: predicted };
			const { data: eff, error } = await supabase
				.from('team_effects')
				.insert({
					team_id: tpu.team_id,
					set_id: tpu.set_id,
					effect_type: 'double_down',
					payload,
					source_team_powerup_id: teamPowerupId
				} as never)
				.select('id')
				.single();
			if (error) return { success: false, error: error.message };
			await supabase
				.from('team_powerups')
				.update({ status: 'active' } as never)
				.eq('id', teamPowerupId);
			return { success: true, effectId: eff.id, payload };
		}

		case 'time_boost': {
			const challengeId = options?.currentChallengeId;
			if (!challengeId) return { success: false, error: 'Time boost requires an active challenge' };

			const { data: attempt } = await supabase
				.from('challenge_attempts')
				.select('id')
				.eq('challenge_id', challengeId)
				.eq('team_id', tpu.team_id)
				.is('ended_at', null)
				.maybeSingle();

			if (!attempt) return { success: false, error: 'No active attempt for this challenge' };

			const { data: ch } = await supabase
				.from('challenges')
				.select('timer_seconds')
				.eq('id', challengeId)
				.maybeSingle();

			if (!ch || ch.timer_seconds == null)
				return { success: false, error: 'Time boost requires a timed challenge' };

			// Store a consumed team_effects row — client reacts via realtime and adds 30s
			// to its countdown. Auto-submit will fire ~30s late which is acceptable.
			await supabase.from('team_effects').insert({
				team_id: tpu.team_id,
				set_id: tpu.set_id,
				effect_type: 'time_boost',
				payload: { added_seconds: 30, challenge_id: challengeId },
				consumed_at: new Date().toISOString(),
				consumed_challenge_id: challengeId,
				source_team_powerup_id: teamPowerupId
			} as never);

			await supabase
				.from('team_powerups')
				.update({ status: 'consumed' } as never)
				.eq('id', teamPowerupId);

			return { success: true };
		}

		case 'insurance': {
			const challengeId = options?.currentChallengeId;
			if (!challengeId) return { success: false, error: 'Insurance requires an active challenge' };

			const { data: attempt } = await supabase
				.from('challenge_attempts')
				.select('id')
				.eq('challenge_id', challengeId)
				.eq('team_id', tpu.team_id)
				.is('ended_at', null)
				.maybeSingle();

			if (!attempt) return { success: false, error: 'No active attempt for this challenge' };

			const { data: eff, error } = await supabase
				.from('team_effects')
				.insert({
					team_id: tpu.team_id,
					set_id: tpu.set_id,
					effect_type: 'insurance',
					payload: { floor_pct: 0.5 },
					source_team_powerup_id: teamPowerupId
				} as never)
				.select('id')
				.single();

			if (error) return { success: false, error: error.message };
			await supabase
				.from('team_powerups')
				.update({ status: 'active' } as never)
				.eq('id', teamPowerupId);
			return { success: true, effectId: eff.id };
		}

		case 'free_answer': {
			const challengeId = options?.currentChallengeId;
			const field = options?.field;
			if (!challengeId || !field)
				return { success: false, error: 'Free answer requires a challenge ID and field selection' };

			const { data: attempt } = await supabase
				.from('challenge_attempts')
				.select('id')
				.eq('challenge_id', challengeId)
				.eq('team_id', tpu.team_id)
				.is('ended_at', null)
				.maybeSingle();

			if (!attempt) return { success: false, error: 'No active attempt for this challenge' };

			// Which (tab, slot) the team is looking at. The challenge page sends both;
			// a caller that sends neither is only honoured on a single-tab challenge
			// (resolveFreeAnswerValue refuses otherwise rather than guessing tab 1).
			const resolved = await resolveFreeAnswerValue(
				supabase,
				challengeId,
				field,
				options?.tabId ?? null,
				options?.slotIndex ?? 0
			);
			// Nothing is written and the powerup stays HELD: the team keeps its
			// one-shot and can retry on a tab/field that does have an answer.
			if ('error' in resolved) return { success: false, error: resolved.error };

			await supabase.from('team_effects').insert({
				team_id: tpu.team_id,
				set_id: tpu.set_id,
				effect_type: 'free_answer',
				// tab_id + slot_index address the reveal (see freeAnswerRevealKey); a
				// payload without them is a pre-fix row, read back as tab 1 / slot 0.
				payload: {
					field,
					value: resolved.value,
					challenge_id: challengeId,
					tab_id: resolved.tabId,
					slot_index: resolved.slotIndex
				},
				consumed_at: new Date().toISOString(),
				consumed_challenge_id: challengeId,
				source_team_powerup_id: teamPowerupId
			} as never);

			await supabase
				.from('team_powerups')
				.update({ status: 'consumed' } as never)
				.eq('id', teamPowerupId);

			return {
				success: true,
				revealedValue: resolved.value,
				revealedTags: resolved.tags,
				revealedTabId: resolved.tabId,
				revealedSlotIndex: resolved.slotIndex
			};
		}

		case 'x_ray': {
			// X-Ray does NOT reveal anything at activation. It opens a BUDGET the team
			// spends one field at a time, on any tab, while it plays — because no tab in
			// this game has five fields, so five reveals only make sense spread across
			// tabs and across time.
			//
			// The budget is a live counter in an ACTIVE (non-consumed) team_effects row,
			// the same "row stays up until something ends it" shape shield and
			// tap_to_break use; what ends it here is the counter reaching zero rather
			// than an attack or a tap. Each spend goes through spendXrayReveal(), which
			// calls free_answer's own resolver per reveal — no reveal work happens here.
			//
			// No challenge gate at activation (unlike free_answer / free_tab): opening a
			// budget mid-lobby is harmless, and the attempt gate that matters lives on
			// each individual reveal instead.
			const budget = resolveXrayBudget(
				parseConfig((gameSet as unknown as { powerup_config?: unknown }).powerup_config)
			);

			// One X-Ray at a time, same rule (and same powerup-stays-held rejection) as
			// shield and double_down. Two counters would race over the same reveals.
			const { data: existingXray } = await supabase
				.from('team_effects')
				.select('id')
				.eq('team_id', tpu.team_id)
				.eq('set_id', tpu.set_id)
				.eq('effect_type', 'x_ray')
				.is('consumed_at', null)
				.limit(1)
				.maybeSingle();
			if (existingXray) return { success: false, error: 'An X-Ray is already running' };

			const payload = { reveals_remaining: budget, reveals_total: budget };
			const { data: eff, error } = await supabase
				.from('team_effects')
				.insert({
					team_id: tpu.team_id,
					set_id: tpu.set_id,
					effect_type: 'x_ray',
					payload,
					source_team_powerup_id: teamPowerupId
				} as never)
				.select('id')
				.single();
			if (error) return { success: false, error: error.message };

			// 'active', not 'consumed' — the powerup is spent only when the last reveal
			// is (spendXrayReveal flips it then).
			await supabase
				.from('team_powerups')
				.update({ status: 'active' } as never)
				.eq('id', teamPowerupId);
			return { success: true, effectId: eff.id, payload };
		}

		case 'free_tab': {
			// Every reveal is one (tab, slot, field) address through free_answer's own
			// resolver — same resolver, same row shape, same addressing as its
			// single-reveal case, just a whole tab's worth of them. A separate
			// implementation is exactly how the bugs fixed in the free_answer pass
			// (tab-1 smearing, tag chips, per-tab keying) would come back.
			const challengeId = options?.currentChallengeId;
			if (!challengeId)
				return { success: false, error: `${powerupType.name} requires an active challenge` };

			// Same gate free_answer uses: a reveal is only meaningful while the team is
			// actually answering this challenge.
			const { data: attempt } = await supabase
				.from('challenge_attempts')
				.select('id')
				.eq('challenge_id', challengeId)
				.eq('team_id', tpu.team_id)
				.is('ended_at', null)
				.maybeSingle();
			if (!attempt) return { success: false, error: 'No active attempt for this challenge' };

			// Dedupe on the SAME address key the page renders badges with, so one cell
			// asked for twice is revealed once.
			const seen = new Set<string>();
			const targets: RevealTarget[] = [];
			for (const t of options?.revealTargets ?? []) {
				if (!t || typeof t.field !== 'string' || !t.field.trim()) continue;
				const slotIndex = Number.isInteger(t.slotIndex) && t.slotIndex >= 0 ? t.slotIndex : 0;
				const key = freeAnswerRevealKey(t.tabId ?? '', slotIndex, t.field);
				if (seen.has(key)) continue;
				seen.add(key);
				targets.push({ tabId: t.tabId, slotIndex, field: t.field });
			}
			if (!targets.length)
				return { success: false, error: `${powerupType.name} needs at least one answer selected` };

			// The target list comes from the client, so the rules are enforced here
			// rather than trusted. Two of them:
			//
			//   één tab    een tweede tab zou een tweede Gratis Tab zijn.
			//   één track  Gratis Tab onthulde ELKE track van de gekozen tab. Op een
			//              fragments-beurt van drie tracks was dat in één klap de hele
			//              beurt. De kiezer in de modal stuurt sinds die wijziging nog
			//              maar één slot mee; dit is de regel die dat afdwingt in plaats
			//              van erop te vertrouwen — een geknutselde post mag de oude,
			//              te sterke uitkomst niet alsnog kunnen halen.
			const distinctTabs = new Set(targets.map((t) => t.tabId ?? ''));
			if (distinctTabs.size > 1)
				return { success: false, error: 'Free Tab reveals one tab, not several' };
			const distinctSlots = new Set(targets.map((t) => t.slotIndex ?? 0));
			if (distinctSlots.size > 1)
				return { success: false, error: 'Free Tab reveals one track, not several' };
			if (targets.length > FREE_TAB_MAX_REVEALS)
				return { success: false, error: 'That is more answers than one track can have' };

			// Resolve each address through free_answer's resolver — the only place that
			// knows how a (tab, slot, field) becomes an answer.
			const reveals: RevealResult[] = [];
			const failures: string[] = [];
			for (const t of targets) {
				const resolved = await resolveFreeAnswerValue(
					supabase,
					challengeId,
					t.field,
					t.tabId ?? null,
					t.slotIndex
				);
				if ('error' in resolved) {
					failures.push(resolved.error);
					continue;
				}
				reveals.push({
					value: resolved.value,
					...(resolved.tags?.length ? { tags: resolved.tags } : {}),
					field: t.field,
					tabId: resolved.tabId,
					slotIndex: resolved.slotIndex
				});
			}

			// Refusal posture, extended from free_answer's rather than reinvented.
			// free_answer has one reveal, so "nothing resolved" and "the activation
			// fails" are the same event: nothing is written and the powerup stays HELD.
			// With several reveals that splits in two, and the same principle decides
			// both: never burn a one-shot for zero answers, never withhold answers that
			// did resolve. So a cell that cannot be resolved (a field this tab does not
			// have, a track with an empty column, `grouping`) is SKIPPED, and only a
			// run in which every cell failed fails the activation.
			if (!reveals.length)
				return { success: false, error: failures[0] ?? 'Nothing could be revealed' };

			// One row per revealed cell — the shape the challenge page's reveal load
			// already reads back (effect_type='free_answer', keyed by tab/slot/field).
			// `source` is additive and ignored by that reader; it records which powerup
			// produced the row without a join back through source_team_powerup_id.
			const nowIso = new Date().toISOString();
			await supabase.from('team_effects').insert(
				reveals.map((r) => ({
					team_id: tpu.team_id,
					set_id: tpu.set_id,
					effect_type: 'free_answer',
					payload: {
						field: r.field,
						value: r.value,
						challenge_id: challengeId,
						tab_id: r.tabId,
						slot_index: r.slotIndex,
						source: typeId
					},
					consumed_at: nowIso,
					consumed_challenge_id: challengeId,
					source_team_powerup_id: teamPowerupId
				})) as never
			);

			await supabase
				.from('team_powerups')
				.update({ status: 'consumed' } as never)
				.eq('id', teamPowerupId);

			return { success: true, reveals };
		}

		case 'all_seeing_eye': {
			// The first powerup that READS another team's play rather than acting on
			// it. Two guards, then a stripped snapshot.
			const challengeId = options?.currentChallengeId;
			if (!challengeId)
				return { success: false, error: `${powerupType.name} requires an active challenge` };

			// ── The refusal ────────────────────────────────────────────────────────
			// If no other team has finished this challenge, the Eye would open on an
			// empty room. Refuse and leave the powerup HELD — no team_effects row, no
			// status change, nothing consumed. Same posture as lifeline's time gate and
			// free_answer's challenge gate: a powerup must never be burned by a click
			// that showed nothing. The team can look again in a minute, which is the
			// timing skill this powerup is built around.
			//
			// Note the ordering: resolveAllSeeingEye() runs BEFORE anything is written,
			// so the refusal path touches no state at all.
			const showScores = resolveEyeShowScores(
				parseConfig((gameSet as unknown as { powerup_config?: unknown }).powerup_config)
			);
			const eyeTeams = await resolveAllSeeingEye(supabase, challengeId, tpu.team_id, showScores);
			if (!eyeTeams.length)
				return {
					success: false,
					error:
						'No other team has finished this challenge yet — the Eye sees nothing. Try again later.'
				};

			const eyeData: AllSeeingEyeData = { challengeId, teams: eyeTeams };

			// Written ALREADY CONSUMED, exactly like lifeline's hint row and
			// free_answer's reveal row: this is a snapshot, not an effect that rides
			// into scoring. Two independent things keep it out of the scorer — consumed
			// rows are invisible to loadActiveEffects, and deriveEffectModifiers has no
			// 'all_seeing_eye' case — so the Eye cannot move a single point.
			//
			// What the row is FOR is the reload: the challenge page reads it back on
			// load, which is what makes the panel survive a refresh. And because what
			// is stored is the already-stripped snapshot, the read-back path has
			// nothing dangerous to hand out either — the strip happened once, here.
			//
			// The snapshot is deliberately FROZEN at this moment: "teams that have
			// already finished" is what was bought. A team that submits later does not
			// appear, which is also what makes WHEN you open the Eye a real decision.
			await supabase.from('team_effects').insert({
				team_id: tpu.team_id,
				set_id: tpu.set_id,
				effect_type: 'all_seeing_eye',
				payload: { challenge_id: challengeId, teams: eyeTeams },
				consumed_at: new Date().toISOString(),
				consumed_challenge_id: challengeId,
				source_team_powerup_id: teamPowerupId
			} as never);

			await supabase
				.from('team_powerups')
				.update({ status: 'consumed' } as never)
				.eq('id', teamPowerupId);

			return { success: true, allSeeingEye: eyeData };
		}

		case 'resurrection': {
			// The only activation that reaches BACKWARDS. Everything else acts on a
			// challenge that is still open; this re-opens one the team already closed.
			//
			// Order is the safety property here, so it is stated up front. Three writes
			// happen, and they are sequenced so that no failure can leave the team able
			// to submit that challenge again WITHOUT a ticket — that is the one
			// combination that would double-count (the submit pipeline would add the
			// retry's points on top of the original's instead of the difference):
			//
			//   1. the ticket        carries old_final + score_mode; nothing is unlocked yet
			//   2. the unlock CAS    is_final true → false. Fails → ticket deleted, refuse
			//   3. the attempt       restarted on the 1/3 clock
			//
			// After (1) alone the challenge is still locked (harmless). After (2) the
			// ticket already exists. There is no window in which the reverse holds.
			const challengeId = options?.resurrectionChallengeId ?? options?.currentChallengeId;
			if (!challengeId)
				return { success: false, error: `${powerupType.name} needs a challenge to bring back` };

			// ── Guard 1: one open retry per team ───────────────────────────────────
			// Not a correctness requirement (a ticket is addressed per challenge, so two
			// would settle independently) but a comprehension one: two challenges live
			// at once, each on its own short clock, is not a state a player can hold in
			// their head. Checked first because it is the cheapest refusal.
			const { data: openTickets } = await supabase
				.from('team_effects')
				.select('id')
				.eq('team_id', tpu.team_id)
				.eq('effect_type', 'resurrection')
				.is('consumed_at', null)
				.limit(1);
			if (openTickets?.length)
				return {
					success: false,
					error: 'You already have a challenge back from the dead — finish that one first'
				};

			// ── Guard 2: an own, FINISHED submission ───────────────────────────────
			// is_final is the honest definition of finished, and after this feature it
			// is also the LOCK (the submit action's 409 reads it), so the two questions
			// have one answer. A non-final row means that challenge is already open —
			// a state this branch must never create twice.
			const { data: sub } = await supabase
				.from('submissions')
				.select('id, answers, score, is_final')
				.eq('challenge_id', challengeId)
				.eq('team_id', tpu.team_id)
				.maybeSingle();
			if (!sub)
				return {
					success: false,
					error: 'You have not finished that challenge yet — there is nothing to bring back'
				};
			if (!sub.is_final)
				return { success: false, error: 'That challenge is already open — go and play it' };

			// ── The old score, read before anything moves ──────────────────────────
			// The retry OVERWRITES this row, so this is the last moment the number
			// exists. It goes into the ticket and the settlement reads it from there —
			// never from the submission, which by then describes the retry.
			const oldFinal = submissionFinalScore(sub);

			const { data: ch } = await supabase
				.from('challenges')
				.select('timer_seconds')
				.eq('id', challengeId)
				.maybeSingle();
			// null on an untimed challenge: nothing to divide, so the retry inherits the
			// untimed behaviour (no deadline, no auto-submit) rather than inventing one.
			const retrySeconds = resurrectionRetrySeconds(ch?.timer_seconds);

			const scoreMode = resolveResurrectionScoreMode(
				parseConfig((gameSet as unknown as { powerup_config?: unknown }).powerup_config)
			);

			// (1) The ticket. NOT consumed — this row IS the open retry, and its
			// consumed_at is what the settlement claims by compare-and-swap so a client
			// submit racing the auto-submit backstop can only book the difference once.
			//
			// deriveEffectModifiers has no 'resurrection' case, so an unconsumed ticket
			// sitting in loadActiveEffects during the retry cannot move a single point
			// of its own — same containment the Eye's row relies on.
			const { data: ticket, error: ticketErr } = await supabase
				.from('team_effects')
				.insert({
					team_id: tpu.team_id,
					set_id: tpu.set_id,
					effect_type: 'resurrection',
					payload: {
						challenge_id: challengeId,
						old_final: oldFinal,
						score_mode: scoreMode,
						retry_seconds: retrySeconds,
						// Kept for the record only. The retry overwrites the attempt row, so
						// without these the original run's timing is unrecoverable.
						original_submission_id: sub.id
					},
					source_team_powerup_id: teamPowerupId
				} as never)
				.select('id')
				.single();
			if (ticketErr || !ticket) return { success: false, error: ticketErr?.message ?? 'Failed' };

			// (2) The unlock, as a compare-and-swap on is_final. Two teams cannot race
			// here (a submission belongs to one team), but a double-click can — and the
			// loser must not get a second ticket for the same re-opening.
			const { data: unlocked } = await supabase
				.from('submissions')
				.update({ is_final: false } as never)
				.eq('id', sub.id)
				.eq('is_final', true)
				.select('id');
			if (!unlocked?.length) {
				// Someone else already opened it. Roll the ticket back so the invariant
				// "an unlocked submission always has exactly one ticket" holds, and leave
				// the powerup HELD — nothing was spent.
				await supabase.from('team_effects').delete().eq('id', ticket.id);
				return { success: false, error: 'That challenge is already open — go and play it' };
			}

			// (3) The attempt, restarted on the short clock. UPSERT rather than insert:
			// challenge_attempts is unique on (challenge_id, team_id)
			// (0014_challenge_attempts.sql), and this is deliberately the SAME row — a
			// second live attempt for one (challenge, team) is exactly what the sweep in
			// /api/auto-submit must never find. Restarting the row also means there is
			// no stale open attempt left behind to fire on.
			await supabase.from('challenge_attempts').upsert(
				{
					challenge_id: challengeId,
					team_id: tpu.team_id,
					started_at: new Date().toISOString(),
					ended_at: null,
					timer_override_seconds: retrySeconds
				} as never,
				{ onConflict: 'challenge_id,team_id' } as never
			);

			// 'active', not 'consumed': the powerup is spent only when the retry
			// settles. consumeResurrectionTicket() (src/lib/server/submit.ts) flips it.
			await supabase
				.from('team_powerups')
				.update({ status: 'active' } as never)
				.eq('id', teamPowerupId);

			await supabase.from('activity_log').insert({
				team_id: tpu.team_id,
				challenge_id: challengeId,
				event_type: 'resurrection_opened',
				payload: { old_final: oldFinal, score_mode: scoreMode, retry_seconds: retrySeconds }
			} as never);

			return {
				success: true,
				effectId: ticket.id,
				resurrection: { challengeId, retrySeconds, oldFinal, scoreMode }
			};
		}

		case 'lifeline': {
			const challengeId = options?.currentChallengeId;
			if (!challengeId)
				return { success: false, error: `${powerupType.name} requires an active challenge` };

			// ── Guard 1: mid-challenge only, and past the halfway mark ─────────────
			// The one TIME-gated activation in the system. attemptElapsedFraction does
			// the whole calculation server-side from challenge_attempts.started_at and
			// the boost-adjusted clock; null means there is nothing to measure — no open
			// attempt, or an untimed challenge, which has no halfway point at all.
			//
			// The two failure messages are deliberately different: "not started" is a
			// different thing for the team to do about it than "too early". Both leave
			// the powerup HELD, the same refusal posture free_answer takes — a Lifeline
			// must never be burned by a click that changed nothing.
			const elapsed = await attemptElapsedFraction(supabase, challengeId, tpu.team_id);
			if (!elapsed)
				return {
					success: false,
					error: 'Lifeline needs a timed challenge you have already started'
				};
			if (elapsed.fraction < LIFELINE_MIN_ELAPSED_FRACTION) {
				const remainingSec = Math.max(
					1,
					Math.ceil((LIFELINE_MIN_ELAPSED_FRACTION - elapsed.fraction) * elapsed.totalSeconds)
				);
				return {
					success: false,
					error: `Too early — Lifeline unlocks halfway through. Try again in ${remainingSec}s.`
				};
			}

			// ── Guard 2: there has to be something to hint at ──────────────────────
			// Every cell already correct (or no answerable cell at all) means the
			// activation would hand over nothing. Stays held, same as above.
			const resolved = await resolveLifelineHints(
				supabase,
				challengeId,
				options?.lifelineDraft ?? {}
			);
			if ('error' in resolved) return { success: false, error: resolved.error };
			if (!resolved.hints.length)
				return { success: false, error: 'Nothing left to hint at — you have them all right!' };

			// Written ALREADY CONSUMED, exactly like free_answer's reveal row: the hint
			// is computed once and stored, not an effect that rides into scoring. Two
			// independent things keep it out of the scorer — consumed rows are invisible
			// to loadActiveEffects, and deriveEffectModifiers has no 'lifeline' case —
			// so Lifeline cannot change a single point. What the row is for is the
			// RELOAD: the challenge page reads it back on load, which is what makes the
			// hints survive a refresh and stay up for the rest of the challenge.
			await supabase.from('team_effects').insert({
				team_id: tpu.team_id,
				set_id: tpu.set_id,
				effect_type: 'lifeline',
				payload: {
					challenge_id: challengeId,
					// Snake_case inside the payload, matching every other stored payload
					// (free_answer's tab_id / slot_index); the camelCase LifelineHint is the
					// in-memory/wire shape.
					hints: resolved.hints.map((h) => ({
						tab_id: h.tabId,
						slot_index: h.slotIndex,
						field: h.field,
						mask: h.mask
					}))
				},
				consumed_at: new Date().toISOString(),
				consumed_challenge_id: challengeId,
				source_team_powerup_id: teamPowerupId
			} as never);

			await supabase
				.from('team_powerups')
				.update({ status: 'consumed' } as never)
				.eq('id', teamPowerupId);

			return { success: true, lifelineHints: resolved.hints };
		}

		case 'penalty_shot': {
			// Purely social — no team_effects row (no scoring impact, no carry-over
			// to any submission), just an activity_log entry so the host sees who
			// owes a shot on /admin/live, and the powerup is spent immediately.
			//
			// challenge_id is carried through (it was dropped before): the host feed
			// showed "owes a shot" with no way to tell which challenge earned it, and
			// on a busy evening that is the difference between a usable line and a
			// notification. Nullable at the source — a shot handed out outside a
			// challenge simply has none.
			await supabase.from('activity_log').insert({
				team_id: tpu.team_id,
				challenge_id: tpu.granted_from_challenge_id,
				event_type: 'penalty_shot',
				payload: { team_id: tpu.team_id }
			} as never);
			await supabase
				.from('team_powerups')
				.update({ status: 'consumed' } as never)
				.eq('id', teamPowerupId);
			return { success: true };
		}

		case 'give_a_shot': {
			// First cross-team attack (stuk 1). Purely social — no scoring impact,
			// same class as penalty_shot — but TARGETED at another team.
			const targetTeamId = options?.targetTeamId;
			if (!targetTeamId) return { success: false, error: 'Give a Shot requires a target team' };
			if (targetTeamId === tpu.team_id)
				return { success: false, error: 'Cannot target your own team' };

			// Denormalize the caster's name so the target's realtime client can render
			// "from Team Red" without a join back through source_team_powerup_id.
			const { data: casterTeam } = await supabase
				.from('teams')
				.select('display_name')
				.eq('id', tpu.team_id)
				.maybeSingle();
			const sourceName = casterTeam?.display_name ?? '';

			// Shield check FIRST — a shielded target absorbs the shot.
			const { blocked } = await tryConsumeShield(supabase, targetTeamId, tpu.set_id);
			if (blocked) {
				return recordShieldBlock(supabase, {
					targetTeamId,
					setId: tpu.set_id,
					teamPowerupId,
					sourceTeamId: tpu.team_id,
					sourceName,
					blockedType: 'give_a_shot'
				});
			}

			// Not blocked: a NON-consumed effect on the target. Non-consumed means an
			// idle target catches it on their next page load, not a missed toast — the
			// target acknowledges it ("Drunk!") which consumes the row.
			await supabase.from('team_effects').insert({
				team_id: targetTeamId,
				set_id: tpu.set_id,
				effect_type: 'give_a_shot',
				payload: { source_team_id: tpu.team_id, source_team_name: sourceName }
			} as never);
			await supabase.from('activity_log').insert({
				team_id: tpu.team_id,
				event_type: 'give_a_shot',
				payload: { source_team_id: tpu.team_id, target_team_id: targetTeamId }
			} as never);
			await supabase
				.from('team_powerups')
				.update({ status: 'consumed' } as never)
				.eq('id', teamPowerupId);
			return { success: true };
		}

		case 'freeze':
		case 'time_drain': {
			// Stuk 2: the two TIMER offensive attacks. Both are payload-driven marker
			// rows, same convention as time_boost — a 30s freeze/pause is arithmetically
			// a +30s extension; a drain is -15s. The auto-submit backstop sums
			// payload.added_seconds across time_boost/freeze/time_drain, so this row
			// alone moves BOTH the client countdown (realtime handler) and the server
			// deadline — no second timer mechanism (the C1 trap this reuses time_boost
			// specifically to avoid).
			const targetTeamId = options?.targetTeamId;
			if (!targetTeamId)
				return { success: false, error: `${powerupType.name} requires a target team` };
			if (targetTeamId === tpu.team_id)
				return { success: false, error: 'Cannot target your own team' };

			// Design B: unlike give_a_shot's anytime exemption, timer effects need a
			// live timed attempt on the target to adjust — no apply-on-next-challenge.
			const targetAttempt = await resolveTargetTimedAttempt(supabase, targetTeamId);
			if (!targetAttempt)
				return { success: false, error: "That team isn't in a timed challenge right now" };

			// Design E: freeze is a STATE (a second freeze while one is active is
			// rejected); time_drain is arithmetic and always stacks (the backstop's
			// summation + the client's += handle that for free, no guard needed).
			if (typeId === 'freeze') {
				const alreadyFrozen = await hasActiveFreeze(
					supabase,
					targetTeamId,
					targetAttempt.challengeId
				);
				if (alreadyFrozen) return { success: false, error: 'Target is already frozen' };
			}

			const { data: casterTeam } = await supabase
				.from('teams')
				.select('display_name')
				.eq('id', tpu.team_id)
				.maybeSingle();
			const sourceName = casterTeam?.display_name ?? '';

			// Shield check FIRST — same shared branch give_a_shot uses. A shielded
			// target absorbs the freeze/drain; the caster's powerup is still spent.
			const { blocked } = await tryConsumeShield(supabase, targetTeamId, tpu.set_id);
			if (blocked) {
				return recordShieldBlock(supabase, {
					targetTeamId,
					setId: tpu.set_id,
					teamPowerupId,
					sourceTeamId: tpu.team_id,
					sourceName,
					blockedType: typeId
				});
			}

			const addedSeconds = typeId === 'freeze' ? 30 : -15;
			await supabase.from('team_effects').insert({
				team_id: targetTeamId,
				set_id: tpu.set_id,
				effect_type: typeId,
				payload: {
					added_seconds: addedSeconds,
					challenge_id: targetAttempt.challengeId,
					source_team_id: tpu.team_id,
					source_team_name: sourceName
				},
				consumed_at: new Date().toISOString(),
				consumed_challenge_id: targetAttempt.challengeId,
				source_team_powerup_id: teamPowerupId
			} as never);
			await supabase.from('activity_log').insert({
				team_id: tpu.team_id,
				event_type: typeId,
				payload: { source_team_id: tpu.team_id, target_team_id: targetTeamId }
			} as never);
			await supabase
				.from('team_powerups')
				.update({ status: 'consumed' } as never)
				.eq('id', teamPowerupId);
			return { success: true };
		}

		case 'tap_to_break': {
			// Stuk 3 (FINAL): the blocking tap-lock — completes the offensive powerups
			// feature. UNLIKE freeze/time_drain/give_a_shot's marker rows, this effect
			// row stays ACTIVE (no consumed_at) until the target taps it out —
			// /api/effects/consume (the ownership-gated endpoint stuk 1 built for
			// give_a_shot's "Drunk!" ack) marks it consumed on break. Because it's
			// non-consumed, loadActiveEffects re-surfaces it on reload for free — no
			// separate persistence mechanism needed.
			const targetTeamId = options?.targetTeamId;
			if (!targetTeamId)
				return { success: false, error: `${powerupType.name} requires a target team` };
			if (targetTeamId === tpu.team_id)
				return { success: false, error: 'Cannot target your own team' };

			// Design B (same as freeze/time_drain): locking a team not mid-challenge
			// is pointless — reject at activation, powerup stays held.
			const targetAttempt = await resolveTargetTimedAttempt(supabase, targetTeamId);
			if (!targetAttempt)
				return { success: false, error: "That team isn't in a timed challenge right now" };

			const alreadyLocked = await hasActiveTapLock(supabase, targetTeamId);
			if (alreadyLocked) return { success: false, error: 'Target is already locked' };

			const { data: casterTeam } = await supabase
				.from('teams')
				.select('display_name')
				.eq('id', tpu.team_id)
				.maybeSingle();
			const sourceName = casterTeam?.display_name ?? '';

			// Shield check FIRST — same shared branch the other three attacks use.
			const { blocked } = await tryConsumeShield(supabase, targetTeamId, tpu.set_id);
			if (blocked) {
				return recordShieldBlock(supabase, {
					targetTeamId,
					setId: tpu.set_id,
					teamPowerupId,
					sourceTeamId: tpu.team_id,
					sourceName,
					blockedType: 'tap_to_break'
				});
			}

			// NON-consumed on purpose (mirrors give_a_shot's non-consumed insert) — no
			// consumed_at, no source_team_powerup_id. The caster's powerup is spent
			// regardless of whether/when the target breaks free; nothing needs to flow
			// back to team_powerups later.
			await supabase.from('team_effects').insert({
				team_id: targetTeamId,
				set_id: tpu.set_id,
				effect_type: 'tap_to_break',
				payload: {
					taps_required: 20,
					challenge_id: targetAttempt.challengeId,
					source_team_id: tpu.team_id,
					source_team_name: sourceName
				}
			} as never);
			await supabase.from('activity_log').insert({
				team_id: tpu.team_id,
				event_type: 'tap_to_break',
				payload: { source_team_id: tpu.team_id, target_team_id: targetTeamId }
			} as never);
			await supabase
				.from('team_powerups')
				.update({ status: 'consumed' } as never)
				.eq('id', teamPowerupId);
			return { success: true };
		}

		default:
			return { success: false, error: `Unknown powerup type: ${typeId}` };
	}
}

/**
 * Resolve the player's choice after the reveal modal.
 * 'store' → status='held' (holdable powerups only)
 * 'lose'  → status='lost'
 */
export async function resolvePowerupChoice(
	supabase: SupabaseClient<Database>,
	teamPowerupId: string,
	choice: 'store' | 'lose'
): Promise<{ ok: boolean; error?: string }> {
	if (choice === 'lose') {
		const { error } = await supabase
			.from('team_powerups')
			.update({ status: 'lost' })
			.eq('id', teamPowerupId)
			.eq('status', 'pending');
		return error ? { ok: false, error: error.message } : { ok: true };
	}

	// store: verify holdable before updating
	const { data: row } = await supabase
		.from('team_powerups')
		.select('id, powerup_type_id, status')
		.eq('id', teamPowerupId)
		.maybeSingle();

	if (!row || row.status !== 'pending') return { ok: false, error: 'Powerup not in pending state' };

	const { data: pt } = await supabase
		.from('powerup_types')
		.select('holdable')
		.eq('id', row.powerup_type_id)
		.maybeSingle();

	if (!pt?.holdable) return { ok: false, error: 'This powerup cannot be stored' };

	const { error } = await supabase
		.from('team_powerups')
		.update({ status: 'held' })
		.eq('id', teamPowerupId);

	return error ? { ok: false, error: error.message } : { ok: true };
}
