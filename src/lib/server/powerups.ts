import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

export type PowerupType = Database['public']['Tables']['powerup_types']['Row'];
export type TeamPowerupRow = Database['public']['Tables']['team_powerups']['Row'];

export type EarnedPowerup = {
	teamPowerupId: string;
	type: PowerupType;
};

/**
 * After a challenge submission, award a powerup if the set has powerups enabled
 * and the team scored above the configured threshold.
 */
export async function maybeAwardPowerup(
	supabase: SupabaseClient<Database>,
	teamId: string,
	setId: string,
	challengeId: string,
	scorePercent: number,
	forcePowerupTypeId?: string
): Promise<EarnedPowerup | null> {
	const { data: gameSet } = await supabase
		.from('game_sets')
		.select('powerups_enabled, powerup_config')
		.eq('id', setId)
		.maybeSingle();

	if (!gameSet?.powerups_enabled) return null;

	const config = (gameSet.powerup_config ?? {}) as Record<string, unknown>;
	const earnThreshold = typeof config.earn_threshold === 'number' ? config.earn_threshold : 70;

	if (scorePercent < earnThreshold) return null;

	// Dev override: pick a specific type if requested (one-shot, cleared by caller)
	if (forcePowerupTypeId) {
		const { data: forcedType } = await supabase
			.from('powerup_types')
			.select('*')
			.eq('id', forcePowerupTypeId)
			.maybeSingle();
		if (!forcedType) return null;
		const { data: inserted } = await supabase
			.from('team_powerups')
			.insert({
				team_id: teamId,
				set_id: setId,
				powerup_type_id: forcedType.id,
				granted_from_challenge_id: challengeId,
				status: 'pending'
			})
			.select('id')
			.single();
		if (!inserted) return null;
		return { teamPowerupId: inserted.id, type: forcedType };
	}

	// Determine eligible types: use set_powerups rows if any exist for this set,
	// otherwise fall back to all enabled_by_default types.
	const { data: setOverrides } = await supabase
		.from('powerup_types')
		.select('*')
		.lte('default_min_score_pct', Math.round(scorePercent))
		.gte('default_max_score_pct', Math.round(scorePercent))
		.eq('enabled_by_default', true)
		.order('sort_order');

	const eligible = setOverrides ?? [];
	if (eligible.length === 0) return null;

	const chosen = eligible[Math.floor(Math.random() * eligible.length)];

	const { data: inserted } = await supabase
		.from('team_powerups')
		.insert({
			team_id: teamId,
			set_id: setId,
			powerup_type_id: chosen.id,
			granted_from_challenge_id: challengeId,
			status: 'pending'
		})
		.select('id')
		.single();

	if (!inserted) return null;

	return { teamPowerupId: inserted.id, type: chosen };
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
};

export type ActivateResult = {
	success: boolean;
	error?: string;
	effectId?: string;
	revealedValue?: string; // free_answer only
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

	if (!tpu || tpu.status !== 'held')
		return { success: false, error: 'Powerup not in held state' };

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
			const { data: eff, error } = await supabase
				.from('team_effects')
				.insert({
					team_id: tpu.team_id,
					set_id: tpu.set_id,
					effect_type: 'bonus_points',
					payload: { value: 15 },
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

		case 'single_event_mult': {
			const { data: eff, error } = await supabase
				.from('team_effects')
				.insert({
					team_id: tpu.team_id,
					set_id: tpu.set_id,
					effect_type: 'single_event_mult',
					payload: { multiplier: 1.5 },
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

		case 'hard_gaan': {
			const windowMinutes =
				(gameSet as unknown as { hard_gaan_window_minutes?: number }).hard_gaan_window_minutes ?? 15;
			const expiresAt = new Date(Date.now() + windowMinutes * 60 * 1000).toISOString();
			const { data: eff, error } = await supabase
				.from('team_effects')
				.insert({
					team_id: tpu.team_id,
					set_id: tpu.set_id,
					effect_type: 'hard_gaan',
					payload: { multiplier: 1.5, window_minutes: windowMinutes },
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
			return { success: true, effectId: eff.id };
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
