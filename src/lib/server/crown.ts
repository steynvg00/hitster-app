import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

type AdminClient = SupabaseClient<Database>;

/**
 * After a team's score is updated, check whether they overtook the crown holder.
 * If so, transfer the crown and add +1 steal bonus to their score.
 * Called with the already-updated new score (old + finalScore).
 */
export async function maybeTransferCrown(
	admin: AdminClient,
	setId: string,
	teamId: string,
	newScore: number
): Promise<void> {
	const { data: gs } = await admin
		.from('game_sets')
		.select('crown_holder_team_id')
		.eq('id', setId)
		.maybeSingle();

	if (!gs) return;

	const currentHolder = gs.crown_holder_team_id;

	// Already the crown holder — no transfer
	if (currentHolder === teamId) return;

	// Get crown holder's current score (0 if no holder yet)
	let holderScore = 0;
	if (currentHolder) {
		const { data: holderTeam } = await admin
			.from('teams')
			.select('score')
			.eq('id', currentHolder)
			.maybeSingle();
		holderScore = holderTeam?.score ?? 0;
	}

	// Only transfer when new score strictly exceeds holder's score
	if (newScore <= holderScore) return;

	// Transfer crown + award steal bonus (+1)
	await Promise.all([
		admin
			.from('game_sets')
			.update({ crown_holder_team_id: teamId } as never)
			.eq('id', setId),
		admin
			.from('teams')
			.update({ score: newScore + 1 })
			.eq('id', teamId),
		admin.from('activity_log').insert({
			team_id: teamId,
			event_type: 'crown_stolen',
			payload: { from_team_id: currentHolder, to_team_id: teamId, score: newScore }
		} as never)
	]);
}

/**
 * At game-end (play_state → 'recap'), award +2 to whoever holds the crown.
 * Idempotent: no-op if crown_payout_applied is already true.
 */
export async function awardCrownPayout(admin: AdminClient, setId: string): Promise<void> {
	const { data: gs } = await admin
		.from('game_sets')
		.select('crown_holder_team_id, crown_payout_applied')
		.eq('id', setId)
		.maybeSingle();

	if (!gs || !gs.crown_holder_team_id) return;
	if ((gs as unknown as { crown_payout_applied?: boolean }).crown_payout_applied) return;

	const teamId = gs.crown_holder_team_id;

	const { data: team } = await admin.from('teams').select('score').eq('id', teamId).maybeSingle();
	if (!team) return;

	await Promise.all([
		admin
			.from('teams')
			.update({ score: team.score + 2 })
			.eq('id', teamId),
		admin
			.from('game_sets')
			.update({ crown_payout_applied: true } as never)
			.eq('id', setId),
		admin.from('activity_log').insert({
			team_id: teamId,
			event_type: 'crown_payout',
			payload: { team_id: teamId, points: 2 }
		} as never)
	]);
}
