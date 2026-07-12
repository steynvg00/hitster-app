import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import type { TeamColor } from '$lib/types';

export const TEAM_COLOR_ORDER: TeamColor[] = ['blue', 'yellow', 'green', 'red', 'indigo', 'black'];

/**
 * Build a Fisher-Yates-shuffled array of team_ids for a set.
 * Distribution: floor(expected/team_count) per team, plus 1 extra for the first
 * (expected % team_count) teams in TEAM_COLOR_ORDER.
 */
export async function generateAssignmentSlots(
	db: SupabaseClient<Database>,
	expectedCount: number,
	teamCount: number
): Promise<string[]> {
	const scopedColors = TEAM_COLOR_ORDER.slice(0, teamCount);
	const { data: teams } = await db.from('teams').select('id, color').in('color', scopedColors);
	if (!teams?.length) return [];

	const orderedTeams = TEAM_COLOR_ORDER.slice(0, teamCount)
		.map((color) => teams.find((t) => t.color === color))
		.filter((t): t is NonNullable<typeof t> => t != null);

	const base = Math.floor(expectedCount / teamCount);
	const extra = expectedCount % teamCount;

	const slots: string[] = [];
	for (let i = 0; i < orderedTeams.length; i++) {
		const count = base + (i < extra ? 1 : 0);
		for (let j = 0; j < count; j++) {
			slots.push(orderedTeams[i].id);
		}
	}

	// Fisher-Yates shuffle
	for (let i = slots.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[slots[i], slots[j]] = [slots[j], slots[i]];
	}

	return slots;
}

/**
 * The teams that belong to a set, in canonical TEAM_COLOR_ORDER. Scoped to the
 * set's team_count — the same derivation the /team lobby uses (there is no
 * set_teams table). Used by the offensive-powerup target picker (stuk 1) to
 * list the teams a caster can attack.
 */
export async function getTeamsInSet(
	db: SupabaseClient<Database>,
	set_id: string
): Promise<Array<{ id: string; color: string; display_name: string }>> {
	const { data: gs } = await db
		.from('game_sets')
		.select('team_count')
		.eq('id', set_id)
		.maybeSingle();
	const teamCount = gs?.team_count ?? 6;
	const scopedColors = TEAM_COLOR_ORDER.slice(0, teamCount);
	const { data: teams } = await db
		.from('teams')
		.select('id, color, display_name')
		.in('color', scopedColors);
	return scopedColors
		.map((color) => (teams ?? []).find((t) => t.color === color))
		.filter((t): t is NonNullable<typeof t> => t != null)
		.map((t) => ({ id: t.id, color: t.color, display_name: t.display_name }));
}

/**
 * Assign a team to a player joining a game set, and write the assignment to
 * the player's row. Uses pre-shuffled slots (atomic via Postgres FOR UPDATE)
 * when configured; otherwise the advisory-locked assign_team_fallback RPC
 * (migration 0052) counts, picks, and writes in a single transaction so a
 * join burst can't stack players onto one team.
 *
 * assignTeam owns the players.set_id/team_id write on BOTH paths — callers
 * must not write it again.
 */
export async function assignTeam(
	db: SupabaseClient<Database>,
	set_id: string,
	team_count: number,
	player_id: string
): Promise<{ team_id: string; team_color: TeamColor }> {
	// Try slot-based assignment (runs inside a Postgres transaction)
	const { data: slotTeamId } = await (db as SupabaseClient).rpc('assign_team_slot', {
		p_set_id: set_id
	});

	if (slotTeamId) {
		const { data: team } = await db
			.from('teams')
			.select('id, color')
			.eq('id', slotTeamId as string)
			.maybeSingle();
		if (team) {
			await db.from('players').update({ set_id, team_id: team.id }).eq('id', player_id);
			return { team_id: team.id, team_color: team.color as TeamColor };
		}
	}

	// Fallback: advisory-locked count → pick → players write, all in one
	// transaction inside Postgres (0052). The tie-random balance rule lives in
	// the function's ORDER BY count, random().
	const { data: teamId, error } = await (db as SupabaseClient).rpc('assign_team_fallback', {
		p_set_id: set_id,
		p_player_id: player_id,
		p_team_count: team_count
	});
	if (error || !teamId) {
		throw new Error(`assign_team_fallback failed: ${error?.message ?? 'no team returned'}`);
	}

	const { data: team } = await db
		.from('teams')
		.select('id, color')
		.eq('id', teamId as string)
		.maybeSingle();
	if (!team) throw new Error('assign_team_fallback returned an unknown team id');
	return { team_id: team.id, team_color: team.color as TeamColor };
}
