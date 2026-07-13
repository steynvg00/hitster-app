// Client-safe Battle Mode ranking math + config parsing, in its own module with
// NO server-only imports (same pattern as powerups-meta.ts) so the pure-function
// harness (tests/bots/verify-battle.ts) can import it under tsx without pulling
// in the DB layer, and .svelte surfaces (stuk 3) can reuse the config parser.
//
// Battle mode is additive: a battle challenge is played exactly like a normal
// one (full score lands at submit); battle ADDS a rank-based ladder bonus at
// resolution. Teams are ranked by base+bonus (submissions.battle_raw_score),
// and each gets ladder[rank] added to teams.score.

export const DEFAULT_BATTLE_LADDER = [10, 7, 5, 3, 1, 0];

export type BattleConfig = { enabled: boolean; ladder: number[] };

/** Read + normalize the battle config off a challenge's points_config JSONB. */
export function parseBattleConfig(pointsConfig: unknown): BattleConfig {
	const battle = ((pointsConfig ?? {}) as Record<string, unknown>).battle as
		| { enabled?: unknown; ladder?: unknown }
		| undefined;
	const enabled = battle?.enabled === true;
	const ladder =
		Array.isArray(battle?.ladder) && battle!.ladder.every((n) => typeof n === 'number')
			? (battle!.ladder as number[])
			: DEFAULT_BATTLE_LADDER;
	return { enabled, ladder };
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
