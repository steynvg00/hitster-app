import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';

type AdminClient = SupabaseClient<Database>;

// NOTE: the [RESET] console.log lines throughout this module are TEMP
// DIAGNOSTIC LOGGING — strip before merge.

export type LastResultEntry = {
	rank: number;
	team_id: string;
	team_name: string;
	score: number;
	photo_url: null;
};

export type ResetResult = {
	notFound: boolean;
	errors: string[];
};

/**
 * Crown + powerup hygiene for one set — the state the documented soft-reset
 * SQL (CLAUDE.md § Reset SQL) clears but the in-app reset actions
 * historically forgot: team_powerups, team_effects,
 * teams.held_powerups/last_threshold_crossed, and
 * game_sets.crown_holder_team_id/crown_payout_applied.
 *
 * Every in-app reset path MUST route through here (directly or via
 * resetGameState) so the paths can't drift apart again — that drift is how
 * a stale crown survived into a fresh round.
 *
 * Pass teamIds: [] to skip the teams powerup-field zeroing (e.g. when the
 * caller already zeroes those columns itself).
 */
export async function clearCrownAndPowerups(
	db: AdminClient,
	setId: string,
	teamIds: string[],
	caller: string
): Promise<string[]> {
	const errors: string[] = [];

	console.log(`[RESET:${caller}] deleting team_powerups for set`, setId);
	const { error: pErr, count: pCount } = await db
		.from('team_powerups')
		.delete({ count: 'exact' })
		.eq('set_id', setId);
	console.log(`[RESET:${caller}] team_powerups delete →`, { pErr, pCount });
	if (pErr) errors.push(`team_powerups delete: ${pErr.message}`);

	const { error: eErr, count: eCount } = await db
		.from('team_effects')
		.delete({ count: 'exact' })
		.eq('set_id', setId);
	console.log(`[RESET:${caller}] team_effects delete →`, { eErr, eCount });
	if (eErr) errors.push(`team_effects delete: ${eErr.message}`);

	if (teamIds.length > 0) {
		const { error: tErr } = await db
			.from('teams')
			.update({ held_powerups: [] as never, last_threshold_crossed: 0 } as never)
			.in('id', teamIds);
		if (tErr) errors.push(`teams powerup fields: ${tErr.message}`);
	}

	const { error: gErr } = await db
		.from('game_sets')
		.update({ crown_holder_team_id: null, crown_payout_applied: false } as never)
		.eq('id', setId);
	console.log(`[RESET:${caller}] crown clear →`, { gErr });
	if (gErr) errors.push(`game_sets crown clear: ${gErr.message}`);

	const { data: gsAfter } = await db
		.from('game_sets')
		.select('crown_holder_team_id, crown_payout_applied')
		.eq('id', setId)
		.maybeSingle();
	console.log(`[RESET:${caller}] crown readback →`, gsAfter);

	return errors;
}

/**
 * Full soft reset for one set — the in-app equivalent of CLAUDE.md's
 * documented soft-reset SQL, scoped to the set. Snapshots last_results
 * (pre-reset ranking) onto the game_sets row before clearing.
 *
 * Clears: challenge_attempts, challenge_hints_used, challenge_unlocks,
 * review_requests, submissions, activity_log, team_powerups, team_effects;
 * zeroes teams score/current_streak/held_powerups/last_threshold_crossed;
 * detaches players; resets game_sets play/recap/assignment state and nulls
 * crown_holder_team_id + crown_payout_applied (via clearCrownAndPowerups).
 *
 * Deliberately does NOT change game_sets.status — deactivation is the
 * caller's decision (endAndReset flips it, plain resets don't).
 */
export async function resetGameState(
	db: AdminClient,
	setId: string,
	caller: string
): Promise<ResetResult> {
	const errors: string[] = [];
	console.log(`[RESET:${caller}] resetGameState invoked, setId =`, setId);

	const { data: gs } = await db
		.from('game_sets')
		.select('team_count')
		.eq('id', setId)
		.maybeSingle();
	if (!gs) return { notFound: true, errors: ['Set not found'] };

	const scopedColors = TEAM_COLOR_ORDER.slice(0, gs.team_count);
	const { data: teams } = await db
		.from('teams')
		.select('id, display_name, score, color')
		.in('color', scopedColors);
	const teamIds = (teams ?? []).map((t) => t.id);

	const { data: setChallenges } = await db
		.from('set_challenges')
		.select('challenge_id')
		.eq('set_id', setId);
	const challengeIds = (setChallenges ?? []).map((sc) => sc.challenge_id);

	// Capture rankings BEFORE clearing
	const sortedTeams = (teams ?? []).sort((a, b) => b.score - a.score);
	const lastResults: LastResultEntry[] = sortedTeams.map((t, i) => ({
		rank: i + 1,
		team_id: t.id,
		team_name: t.display_name,
		score: t.score,
		photo_url: null
	}));

	// Awaited, error-checked deletes (no fire-and-forget)
	const run = async (label: string, p: PromiseLike<{ error: { message: string } | null }>) => {
		const { error } = await p;
		if (error) {
			console.log(`[RESET:${caller}] ${label} FAILED →`, error.message);
			errors.push(`${label}: ${error.message}`);
		}
	};

	if (challengeIds.length > 0) {
		const { data: subRows } = await db
			.from('submissions')
			.select('id')
			.in('challenge_id', challengeIds)
			.in('team_id', teamIds);
		const subIds = (subRows ?? []).map((s) => s.id);

		await run(
			'challenge_attempts delete',
			db.from('challenge_attempts').delete().in('challenge_id', challengeIds)
		);
		await run(
			'challenge_hints_used delete',
			db.from('challenge_hints_used').delete().in('challenge_id', challengeIds)
		);
		if (subIds.length > 0) {
			await run(
				'review_requests delete',
				db.from('review_requests').delete().in('submission_id', subIds)
			);
		}
		await run(
			'submissions delete',
			db.from('submissions').delete().in('challenge_id', challengeIds).in('team_id', teamIds)
		);
	}
	await run('challenge_unlocks delete', db.from('challenge_unlocks').delete().eq('set_id', setId));

	if (teamIds.length > 0) {
		await run('activity_log delete', db.from('activity_log').delete().in('team_id', teamIds));
		await run(
			'teams reset',
			db
				.from('teams')
				.update({
					score: 0,
					current_streak: 0,
					held_powerups: [] as never,
					last_threshold_crossed: 0
				} as never)
				.in('id', teamIds)
		);
	}

	// Crown + powerup hygiene (teams powerup fields already zeroed above → [])
	errors.push(...(await clearCrownAndPowerups(db, setId, [], caller)));

	await run(
		'players detach',
		db.from('players').update({ set_id: null, team_id: null }).eq('set_id', setId)
	);

	await run(
		'game_sets reset',
		db
			.from('game_sets')
			.update({
				play_state: 'joining',
				started_at: null,
				ended_at: null,
				scores_hidden: false,
				recap_ranking: [] as never,
				recap_reveal_index: 0,
				recap_state: 'pending',
				assignment_slots: [] as never,
				assignment_index: 0,
				last_results: lastResults as never
			})
			.eq('id', setId)
	);

	console.log(`[RESET:${caller}] resetGameState done, errors =`, errors);
	return { notFound: false, errors };
}
