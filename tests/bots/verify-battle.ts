// Battle Mode ranking-engine verification (stuk 1/3, refined stuk 2).
//
//   npm run bots:verify-battle
//
// Pure-function harness — NO app, NO DB, NO Playwright (battle.ts's ranking math
// has only `import type` deps + getTeamsInSet/crown at the DB layer, but
// computeBattleRanking + deriveLadder themselves are pure). This is the GATE for
// the ranking arithmetic: ladder derivation from max_points + team_count,
// raw-desc ordering, speed tiebreak, average-split on exact ties, ladder
// overflow, and non-participant / empty-submit placement.
//
// Ladder model (stuk 2): the ladder is no longer stored — it's DERIVED at
// resolution time from a single max_points value + the set's real team_count
// (linear max→0 in equal steps, last rank always 0). computeBattleRanking still
// takes an explicit ladder array (its tie/split/rank logic is unchanged); the
// scenarios below build that ladder via deriveLadder(maxPoints, teamCount)
// rather than hand-writing it, so a derivation regression fails here too.
//
// The DB-integration behaviors — CAS idempotency (resolveBattle twice awards
// once), the batch crown recompute (+1 steal to the post-battle leader), and
// "the full challenge score is never re-added at resolution" — are structural
// (CAS claim + reading battle_raw_score, never re-scoring) and are spot-checked
// live with concurrent submits, not asserted here.

import {
	computeBattleRanking,
	deriveLadder,
	type BattleEntry
} from '../../src/lib/battle-ranking';

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass
			? `${JSON.stringify(got)}`
			: `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
	});
}

// Award for a given team_id out of a ranking result.
const awardOf = (r: ReturnType<typeof computeBattleRanking>, id: string) =>
	r.find((e) => e.team_id === id)?.awarded ?? -1;
const rankOf = (r: ReturnType<typeof computeBattleRanking>, id: string) =>
	r.find((e) => e.team_id === id)?.rank ?? -1;

// ── 0: deriveLadder unit checks ───────────────────────────────────────────────
{
	assert('0 M=10 N=6 → [10,8,6,4,2,0]', deriveLadder(10, 6), [10, 8, 6, 4, 2, 0]);
	assert('0 M=10 N=4 → [10,7,3,0] (6.67→7, 3.33→3)', deriveLadder(10, 4), [10, 7, 3, 0]);
	assert('0 M=10 N=2 → [max,0]', deriveLadder(10, 2), [10, 0]);
	assert('0 N=1 → [0] (no divide-by-zero)', deriveLadder(10, 1), [0]);
	assert('0 N=1 → [0] regardless of max', deriveLadder(999, 1), [0]);
}

// ── 1: six distinct raws → the derived ladder maps 1:1 ────────────────────────
{
	const L6 = deriveLadder(10, 6); // [10,8,6,4,2,0]
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 20, elapsed: 10 },
		{ teamId: 'B', raw: 15, elapsed: 10 },
		{ teamId: 'C', raw: 10, elapsed: 10 },
		{ teamId: 'D', raw: 5, elapsed: 10 },
		{ teamId: 'E', raw: 2, elapsed: 10 },
		{ teamId: 'F', raw: 1, elapsed: 10 }
	];
	const r = computeBattleRanking(e, L6);
	assert('1 A rank1 → 10', [rankOf(r, 'A'), awardOf(r, 'A')], [1, 10]);
	assert('1 B rank2 → 8', [rankOf(r, 'B'), awardOf(r, 'B')], [2, 8]);
	assert('1 C rank3 → 6', [rankOf(r, 'C'), awardOf(r, 'C')], [3, 6]);
	assert('1 F rank6 → 0', [rankOf(r, 'F'), awardOf(r, 'F')], [6, 0]);
}

// ── 2: no-show ranks last of six → 0 ──────────────────────────────────────────
{
	const L6 = deriveLadder(10, 6);
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 20, elapsed: 10 },
		{ teamId: 'B', raw: 15, elapsed: 10 },
		{ teamId: 'C', raw: 10, elapsed: 10 },
		{ teamId: 'D', raw: 5, elapsed: 10 },
		{ teamId: 'E', raw: 2, elapsed: 10 },
		{ teamId: 'F', raw: 0, elapsed: Infinity } // no attempt
	];
	const r = computeBattleRanking(e, L6);
	assert('2 no-show F rank6 → 0', [rankOf(r, 'F'), awardOf(r, 'F')], [6, 0]);
	assert(
		'2 no-show elapsed recorded null',
		r.find((x) => x.team_id === 'F')?.elapsed_seconds,
		null
	);
}

// ── 3: empty-but-played (raw 0, finite elapsed) ranks ABOVE a no-show ─────────
{
	const L3 = deriveLadder(10, 3); // [10,5,0]
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 10, elapsed: 30 },
		{ teamId: 'B', raw: 0, elapsed: 45 }, // played, empty draft
		{ teamId: 'C', raw: 0, elapsed: Infinity } // never played
	];
	const r = computeBattleRanking(e, L3);
	assert('3 played-empty B rank2', rankOf(r, 'B'), 2);
	assert('3 no-show C rank3', rankOf(r, 'C'), 3);
	assert('3 B award (5) > C award (0)', awardOf(r, 'B') > awardOf(r, 'C'), true);
	// Not an exact tie (elapsed differs) → distinct positions, NOT averaged.
	assert('3 B=5 C=0 (distinct, not split)', [awardOf(r, 'B'), awardOf(r, 'C')], [5, 0]);
}

// ── 4: speed tiebreak on equal raw → faster wins, distinct (not averaged) ─────
{
	const L2 = deriveLadder(10, 2); // [10,0]
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 15, elapsed: 20 },
		{ teamId: 'B', raw: 15, elapsed: 40 }
	];
	const r = computeBattleRanking(e, L2);
	assert('4 faster A rank1 → 10', [rankOf(r, 'A'), awardOf(r, 'A')], [1, 10]);
	assert('4 slower B rank2 → 0', [rankOf(r, 'B'), awardOf(r, 'B')], [2, 0]);
}

// ── 5: exact tie → average-split, clean ((8+6)/2 = 7) ─────────────────────────
{
	const L6 = deriveLadder(10, 6); // [10,8,6,4,2,0]
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 30, elapsed: 10 },
		{ teamId: 'B', raw: 20, elapsed: 15 }, // identical raw+elapsed → tie for ranks 2–3
		{ teamId: 'C', raw: 20, elapsed: 15 },
		{ teamId: 'D', raw: 10, elapsed: 10 },
		{ teamId: 'E', raw: 5, elapsed: 10 },
		{ teamId: 'F', raw: 0, elapsed: 10 }
	];
	const r = computeBattleRanking(e, L6);
	assert('5 A rank1 → 10', [rankOf(r, 'A'), awardOf(r, 'A')], [1, 10]);
	assert('5 B tied rank2 → avg(8+6)/2=7', [rankOf(r, 'B'), awardOf(r, 'B')], [2, 7]);
	assert('5 C tied rank2 → avg(8+6)/2=7', [rankOf(r, 'C'), awardOf(r, 'C')], [2, 7]);
	assert('5 D rank4 → 4', awardOf(r, 'D'), 4);
	assert('5 E rank5 → 2', awardOf(r, 'E'), 2);
	assert('5 F rank6 → 0', awardOf(r, 'F'), 0);
}

// ── 6: exact tie → average-split, rounded ((10+7)/2 = 8.5 → 9, half up) ───────
{
	const L4 = deriveLadder(10, 4); // [10,7,3,0]
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 20, elapsed: 15 },
		{ teamId: 'B', raw: 20, elapsed: 15 },
		{ teamId: 'C', raw: 10, elapsed: 10 },
		{ teamId: 'D', raw: 0, elapsed: 10 }
	];
	const r = computeBattleRanking(e, L4);
	assert('6 A tied rank1 → round(8.5)=9', [rankOf(r, 'A'), awardOf(r, 'A')], [1, 9]);
	assert('6 B tied rank1 → round(8.5)=9', [rankOf(r, 'B'), awardOf(r, 'B')], [1, 9]);
	assert('6 C rank3 → 3', awardOf(r, 'C'), 3);
	assert('6 D rank4 → 0', awardOf(r, 'D'), 0);
}

// ── 7: two no-shows split the bottom positions ((3+0)/2 = 1.5 → 2) ────────────
{
	const L4 = deriveLadder(10, 4); // [10,7,3,0]
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 20, elapsed: 10 },
		{ teamId: 'B', raw: 10, elapsed: 10 },
		{ teamId: 'C', raw: 0, elapsed: Infinity }, // no-show
		{ teamId: 'D', raw: 0, elapsed: Infinity } // no-show — exact tie with C
	];
	const r = computeBattleRanking(e, L4);
	assert('7 A rank1 → 10', awardOf(r, 'A'), 10);
	assert('7 B rank2 → 7', awardOf(r, 'B'), 7);
	assert('7 C+D tied rank3 → avg round((3+0)/2)=2', [awardOf(r, 'C'), awardOf(r, 'D')], [2, 2]);
	assert('7 C+D share rank 3', [rankOf(r, 'C'), rankOf(r, 'D')], [3, 3]);
}

// ── 8: ladder shorter than the field → overflow positions award 0 ────────────
// Structural robustness of computeBattleRanking itself — NOT a derived-ladder
// case (deriveLadder always emits exactly teamCount entries, so this can't
// happen via the real config path). Kept as a defensive gate on the ranking
// function's overflow handling.
{
	const shortLadder = [10, 5];
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 20, elapsed: 10 },
		{ teamId: 'B', raw: 15, elapsed: 10 },
		{ teamId: 'C', raw: 10, elapsed: 10 },
		{ teamId: 'D', raw: 5, elapsed: 10 }
	];
	const r = computeBattleRanking(e, shortLadder);
	assert('8 A rank1 → 10', awardOf(r, 'A'), 10);
	assert('8 B rank2 → 5', awardOf(r, 'B'), 5);
	assert('8 C rank3 → 0 (overflow)', awardOf(r, 'C'), 0);
	assert('8 D rank4 → 0 (overflow)', awardOf(r, 'D'), 0);
}

// ── report ────────────────────────────────────────────────────────────────────
console.log('─── Battle Mode ranking engine (stuk 1/2) ───');
for (const c of checks) {
	console.log(`  ${c.pass ? '✅' : '❌'} ${c.name.padEnd(50)} ${c.pass ? '' : c.detail}`);
}
const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
console.log(
	'\n(DB-integration: CAS idempotency + batch crown +1 + no-score-re-add — spot-checked live with concurrent submits.)'
);
if (passed !== checks.length) process.exit(1);
