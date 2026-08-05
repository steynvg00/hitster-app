import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import type { AnswerField, PowerupConfigV2, ThresholdMode, BandMode, PowerupTypeOverride } from '$lib/types';
import {
	artistTargets,
	computeSetMaxScore,
	correctValueForField,
	fieldMapsFromResolved,
	getSourceTracksForTab,
	resolveTabFields,
	type ClipRaw,
	type MashupSourceRaw,
	type TabClipData,
	type TabSourceTrackRaw,
	type TrackData
} from '$lib/server/scoring';

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

export type EarnedPowerup = {
	teamPowerupId: string;
	type: PowerupType;
	// Present when type.immediate_use — the effect was auto-activated at earn time.
	activation?: ActivateResult;
};

// ─── Earning v2: pure planner (piece 3a) ─────────────────────────────────────

export type PlannedAward = { typeId: string; channel: 'ladder' | 'inverse' };

export type PlanContext = {
	submissionPct: number; // this submission's score % (drives type-eligibility everywhere)
	cumulativePct: number; // teamScore / setMax % (only used by cumulative band-firing)
	thresholdMode: ThresholdMode;
	bandMode: BandMode;
	lastThresholdCrossed: number; // teams.last_threshold_crossed (cumulative highwater)
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
 *  - Normal pool (same for every band): non-coming_soon, non-inverse types that are
 *    enabled (override ?? enabled_by_default), category-on, and whose per-type
 *    threshold (override ?? default_min_score_pct) ≤ submissionPct ≤ default_max_score_pct.
 *  - x bands = up to x awards: each fired band rolls each pool type against its
 *    chance (override ?? 1); if any survive, one is randomly picked.
 *  - Inverse channel (per submission, ladder-independent): each enabled inverse type
 *    whose submissionPct < its bound (override ?? default_max_score_pct) rolls its
 *    chance. "Inverse" is resolved as `override.inverse ?? type.default_inverse`
 *    (piece 4) — the console has no control to set the per-set override, so a
 *    type's inverse-ness is a fixed trait (default_inverse), just like
 *    enabled_by_default; the config key exists only as a theoretical future
 *    per-set override, never written by the console today.
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
		const ov = cfg.types[t.id];
		if (t.coming_soon) return false;
		if (!(ov?.enabled ?? t.enabled_by_default)) return false;
		if (!(cfg.categories[t.category] ?? true)) return false;
		if (ov?.inverse ?? t.default_inverse) return false;
		const minThreshold = ov?.threshold ?? t.default_min_score_pct;
		return ctx.submissionPct >= minThreshold && ctx.submissionPct <= t.default_max_score_pct;
	});

	const awards: PlannedAward[] = [];

	// Ladder channel: one roll-and-pick per fired band.
	for (let i = 0; i < crossed.length; i++) {
		const rolled = pool.filter((t) => rand() < (cfg.types[t.id]?.chance ?? 1));
		if (rolled.length) {
			const pick = rolled[Math.floor(rand() * rolled.length)];
			awards.push({ typeId: pick.id, channel: 'ladder' });
		}
	}

	// Inverse channel: per-submission, independent of the ladder / highwater.
	for (const t of types) {
		const ov = cfg.types[t.id];
		if (!(ov?.inverse ?? t.default_inverse)) continue;
		if (t.coming_soon) continue;
		if (!(ov?.enabled ?? t.enabled_by_default)) continue;
		if (!(cfg.categories[t.category] ?? true)) continue;
		const bound = ov?.threshold ?? t.default_max_score_pct;
		if (ctx.submissionPct < bound && rand() < (ov?.chance ?? 1)) {
			awards.push({ typeId: t.id, channel: 'inverse' });
		}
	}

	return { awards, newHighwater };
}

// ─── Earning v2: IO wrapper (piece 3a) ───────────────────────────────────────

/** Insert a pending team_powerup and auto-activate it if it's an immediate-use type. */
async function materializeAward(
	supabase: SupabaseClient<Database>,
	teamId: string,
	setId: string,
	challengeId: string,
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

/** Read the cached set-max, or compute + cache it (cumulative mode only). */
async function getOrComputeSetMax(
	supabase: SupabaseClient<Database>,
	setId: string,
	cfg: PowerupConfigV2
): Promise<number> {
	if (typeof cfg.computed_set_max === 'number') return cfg.computed_set_max;
	const setMax = await computeSetMaxScore(supabase, setId);
	// Cache back into powerup_config. NOT invalidated when the set's challenge list
	// changes (that goes through a different action) — acceptable party-game staleness.
	const merged = mergePowerupConfig(cfg, { computed_set_max: setMax });
	await supabase
		.from('game_sets')
		.update({ powerup_config: merged as never })
		.eq('id', setId);
	return setMax;
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
	forcePowerupTypeId?: string
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
		const setMax = await getOrComputeSetMax(supabase, setId, cfg);
		cumulativePct = setMax > 0 ? ((team?.score ?? 0) / setMax) * 100 : 0;
	}

	const plan = planAwards(
		cfg,
		types as PowerupType[],
		{
			submissionPct,
			cumulativePct,
			thresholdMode: cfg.threshold_mode,
			bandMode: cfg.band_mode,
			lastThresholdCrossed
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
				bonusPoints += (e.payload.value as number | undefined) ?? 15;
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

export type ActivateResult = {
	success: boolean;
	error?: string;
	effectId?: string;
	revealedValue?: string; // free_answer only
	revealedTags?: string[]; // free_answer on `artist`: the scorer's targets, for the tag input
	revealedTabId?: string; // free_answer: which tab the value belongs to
	revealedSlotIndex?: number; // free_answer: which answer slot within that tab
	payload?: Record<string, unknown>; // the team_effects payload that was written
	blocked?: boolean; // offensive types: the target's shield absorbed the attack
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

	// grouping is scored across the whole tab by scoreTabGrouping, not per track —
	// there is no single value to hand back.
	if (field === 'grouping')
		return { error: 'Grouping has no single answer to reveal — pick another field' };

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
		supabase.from('challenge_tab_source_tracks').select('*').eq('tab_id', tab.id).order('sort_order'),
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

	const value = correctValueForField(field as AnswerField, slot.track);
	// A misconfigured track (empty column) would otherwise reveal '' and still burn
	// the powerup — the exact silent failure the old lookup had for vocal_source.
	if (!value.trim()) return { error: `This track has no ${fieldLabel} on file — nothing to reveal` };

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
		.select('status, play_state, hard_gaan_window_minutes')
		.eq('id', tpu.set_id)
		.maybeSingle();

	if (!gameSet || gameSet.status !== 'active')
		return { success: false, error: 'Game set is not active' };

	const typeId = powerupType.id;

	// 3. Type-specific activation
	switch (typeId) {
		case 'bonus_points': {
			const payload = { value: 15 };
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

		case 'single_event_mult': {
			const payload = { multiplier: 1.5 };
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

		case 'penalty_shot': {
			// Purely social — no team_effects row (no scoring impact, no carry-over
			// to any submission), just an activity_log entry so the host sees who
			// owes a shot on /admin/live, and the powerup is spent immediately.
			await supabase.from('activity_log').insert({
				team_id: tpu.team_id,
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
