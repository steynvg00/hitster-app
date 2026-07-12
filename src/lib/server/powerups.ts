import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import type { PowerupConfigV2, ThresholdMode, BandMode, PowerupTypeOverride } from '$lib/types';
import { computeSetMaxScore } from '$lib/server/scoring';

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

	const thresholdMode: ThresholdMode = obj.threshold_mode === 'cumulative' ? 'cumulative' : 'per_challenge';
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
	const computedSetMax = typeof obj.computed_set_max === 'number' ? obj.computed_set_max : undefined;

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
		categories: patch.categories ? { ...current.categories, ...patch.categories } : current.categories
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
	toConsume: ActiveEffect[];
} {
	const now = Date.now();
	const extraMultipliers: number[] = [];
	let insuranceActive = false;
	let bonusPoints = 0;
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
		}
	}

	return { extraMultipliers, insuranceActive, bonusPoints, toConsume };
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
	field?: string;            // free_answer: which field to reveal
	currentChallengeId?: string; // free_answer / time_boost / insurance gating
	// Immediate-use types (bonus_points, hard_gaan, single_event_mult) auto-activate
	// straight from the earn path, before the player ever "holds" them.
	allowFromPending?: boolean;
};

export type ActivateResult = {
	success: boolean;
	error?: string;
	effectId?: string;
	revealedValue?: string; // free_answer only
	payload?: Record<string, unknown>; // the team_effects payload that was written
};

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

	const statusOk = tpu?.status === 'held' || (options?.allowFromPending && tpu?.status === 'pending');
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
				(gameSet as unknown as { hard_gaan_window_minutes?: number }).hard_gaan_window_minutes ?? 15;
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

		case 'time_boost': {
			const challengeId = options?.currentChallengeId;
			if (!challengeId)
				return { success: false, error: 'Time boost requires an active challenge' };

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
			await supabase
				.from('team_effects')
				.insert({
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
			if (!challengeId)
				return { success: false, error: 'Insurance requires an active challenge' };

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

			// Get the correct answer for the requested field from the challenge's first track
			const { data: tabs } = await supabase
				.from('challenge_tabs')
				.select('id')
				.eq('challenge_id', challengeId)
				.order('position')
				.limit(1);

			const firstTabId = tabs?.[0]?.id;
			let revealedValue: string | undefined;

			if (firstTabId) {
				const { data: src } = await supabase
					.from('challenge_tab_source_tracks')
					.select('track_id')
					.eq('tab_id', firstTabId)
					.order('sort_order')
					.limit(1)
					.maybeSingle();

				if (src?.track_id) {
					const { data: track } = await supabase
						.from('tracks')
						.select('*')
						.eq('id', src.track_id)
						.maybeSingle();

					if (track) {
						const fieldMap: Record<string, string> = {
							artist: track.artist ?? '',
							title: track.title ?? '',
							year: String(track.year ?? ''),
							label: (track as unknown as { record_label?: string }).record_label ?? '',
							festival: (track as unknown as { festival?: string }).festival ?? ''
						};
						revealedValue = fieldMap[field] ?? '';
					}
				}
			}

			await supabase
				.from('team_effects')
				.insert({
					team_id: tpu.team_id,
					set_id: tpu.set_id,
					effect_type: 'free_answer',
					payload: { field, value: revealedValue ?? '', challenge_id: challengeId },
					consumed_at: new Date().toISOString(),
					consumed_challenge_id: challengeId,
					source_team_powerup_id: teamPowerupId
				} as never);

			await supabase
				.from('team_powerups')
				.update({ status: 'consumed' } as never)
				.eq('id', teamPowerupId);

			return { success: true, revealedValue };
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
