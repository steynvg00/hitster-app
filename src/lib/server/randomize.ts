import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import type { TeamColor } from '$lib/types';

export const TEAM_COLOR_ORDER: TeamColor[] = ['blue', 'yellow', 'green', 'red', 'indigo', 'black'];

/**
 * Snake-order team assignment for a game set.
 * Picks the team with the fewest players currently in this set.
 * Ties broken by stable color order (blue first).
 */
export async function assignTeam(
	db: SupabaseClient<Database>,
	set_id: string,
	team_count: number
): Promise<{ team_id: string; team_color: TeamColor }> {
	const scopedColors = TEAM_COLOR_ORDER.slice(0, team_count);

	const [{ data: teams }, { data: existing }] = await Promise.all([
		db.from('teams').select('id, color').in('color', scopedColors),
		db.from('players').select('team_id').eq('set_id', set_id).not('team_id', 'is', null)
	]);

	if (!teams || teams.length === 0) throw new Error('No teams configured');

	const countMap = new Map<string, number>();
	for (const row of existing ?? []) {
		if (row.team_id) countMap.set(row.team_id, (countMap.get(row.team_id) ?? 0) + 1);
	}

	const sorted = [...teams].sort((a, b) => {
		const ca = countMap.get(a.id) ?? 0;
		const cb = countMap.get(b.id) ?? 0;
		if (ca !== cb) return ca - cb;
		return (
			TEAM_COLOR_ORDER.indexOf(a.color as TeamColor) -
			TEAM_COLOR_ORDER.indexOf(b.color as TeamColor)
		);
	});

	return { team_id: sorted[0].id, team_color: sorted[0].color as TeamColor };
}
