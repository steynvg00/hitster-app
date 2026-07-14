// Client-safe Battle Mode ranking math + config parsing, in its own module with
// NO server-only imports (same pattern as powerups-meta.ts) so the pure-function
// harness (tests/bots/verify-battle.ts) can import it under tsx without pulling
// in the DB layer, and .svelte surfaces (stuk 3) can reuse the config parser.
//
// Battle mode is additive: a battle challenge is played exactly like a normal
// one (full score lands at submit); battle ADDS a rank-based ladder bonus at
// resolution. Teams are ranked by base+bonus (submissions.battle_raw_score),
// and each gets ladder[rank] added to teams.score.

export const DEFAULT_MAX_POINTS = 10;

export type BattleConfig = { enabled: boolean; max_points: number };

/**
 * Read + normalize the battle config off a challenge's points_config JSONB.
 * Storage shape is { enabled, max_points } — the ladder is no longer stored;
 * it's derived at resolution time from max_points + the set's real team_count
 * (see deriveLadder below). A legacy { ladder } shape (pre-stuk-2) is tolerated
 * by simply ignoring it and falling back to the default max_points — battle
 * mode has no production challenges yet, so there's no data to migrate.
 */
export function parseBattleConfig(pointsConfig: unknown): BattleConfig {
	const battle = ((pointsConfig ?? {}) as Record<string, unknown>).battle as
		| { enabled?: unknown; max_points?: unknown }
		| undefined;
	const enabled = battle?.enabled === true;
	const max_points =
		typeof battle?.max_points === 'number' &&
		Number.isFinite(battle.max_points) &&
		battle.max_points >= 0
			? battle.max_points
			: DEFAULT_MAX_POINTS;
	return { enabled, max_points };
}

/**
 * Derive the award ladder from a single max-points value + the real team
 * count (computed at resolution time, never stored). Linear from max down to
 * 0 in equal steps: rank r (0-indexed) awards round(M × (N-1-r)/(N-1)); the
 * last rank always lands on exactly 0. N=1 is a degenerate case (a 1-team
 * "battle" is meaningless) — that sole team gets 0, no division by zero.
 *
 * Examples: deriveLadder(10, 6) → [10,8,6,4,2,0]; deriveLadder(10, 4) →
 * [10,7,3,0] (6.67→7, 3.33→3, half-up rounding via Math.round).
 */
export function deriveLadder(maxPoints: number, teamCount: number): number[] {
	if (teamCount <= 1) return [0];
	const ladder: number[] = [];
	for (let r = 0; r < teamCount; r++) {
		ladder.push(Math.round((maxPoints * (teamCount - 1 - r)) / (teamCount - 1)));
	}
	return ladder;
}

export type BattleEntry = { teamId: string; raw: number; elapsed: number };
export type BattleRankEntry = {
	team_id: string;
	rank: number;
	raw_score: number;
	awarded: number;
	elapsed_seconds: number | null;
};

/**
 * Pure ranking + ladder-award computation (the harness gate). Ranks by raw
 * (base+bonus) descending, tiebreak by elapsed ascending (faster wins). Teams
 * with an EXACT (raw, elapsed) tie form a block that SHARES the rounded average
 * of the ladder positions the block occupies (e.g. tied for positions 2–3 on
 * [10,7,5,…] → both get round((7+5)/2)=6). Ranks use competition numbering
 * (a tied block shares its top rank; the next block's rank skips accordingly).
 * A ladder shorter than the field → overflow positions award 0.
 *
 * elapsed is +Infinity for a team with no timed attempt (a no-show) — it sorts
 * below any team that actually played (finite elapsed), even one that scored 0.
 */
export function computeBattleRanking(entries: BattleEntry[], ladder: number[]): BattleRankEntry[] {
	const ladderAt = (pos: number) => (pos >= 0 && pos < ladder.length ? ladder[pos] : 0);
	// raw desc, then elapsed asc — Infinity-safe (no NaN when both are Infinity).
	const sorted = [...entries].sort((a, b) => {
		if (b.raw !== a.raw) return b.raw - a.raw;
		if (a.elapsed === b.elapsed) return 0;
		return a.elapsed < b.elapsed ? -1 : 1;
	});

	const out: BattleRankEntry[] = [];
	let i = 0;
	while (i < sorted.length) {
		// Tie-group: identical raw AND identical elapsed occupy positions i..j.
		let j = i;
		while (
			j + 1 < sorted.length &&
			sorted[j + 1].raw === sorted[i].raw &&
			sorted[j + 1].elapsed === sorted[i].elapsed
		) {
			j++;
		}
		let sum = 0;
		for (let p = i; p <= j; p++) sum += ladderAt(p);
		const awarded = Math.round(sum / (j - i + 1));
		const rank = i + 1; // competition ranking: the tied block shares its top rank
		for (let k = i; k <= j; k++) {
			out.push({
				team_id: sorted[k].teamId,
				rank,
				raw_score: sorted[k].raw,
				awarded,
				elapsed_seconds: Number.isFinite(sorted[k].elapsed) ? sorted[k].elapsed : null
			});
		}
		i = j + 1;
	}
	return out;
}
