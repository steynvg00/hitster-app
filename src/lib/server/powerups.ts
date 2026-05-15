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
	scorePercent: number
): Promise<EarnedPowerup | null> {
	const { data: gameSet } = await supabase
		.from('game_sets')
		.select('powerups_enabled, powerup_config')
		.eq('id', setId)
		.maybeSingle();

	if (!gameSet?.powerups_enabled) return null;

	const config = (gameSet.powerup_config ?? {}) as Record<string, unknown>;
	const earnThreshold =
		typeof config.earn_threshold === 'number' ? config.earn_threshold : 70;

	if (scorePercent < earnThreshold) return null;

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
