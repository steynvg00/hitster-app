// Battle Mode ranking-engine verification (stuk 1/3).
//
//   npm run bots:verify-battle
//
// Pure-function harness — NO app, NO DB, NO Playwright (battle.ts's ranking math
// has only `import type` deps + getTeamsInSet/crown at the DB layer, but
// computeBattleRanking itself is pure). This is the GATE for the ranking
// arithmetic: raw-desc ordering, speed tiebreak, average-split on exact ties,
// ladder overflow, and non-participant / empty-submit placement.
//
// The DB-integration behaviors — CAS idempotency (resolveBattle twice awards
// once), the batch crown recompute (+1 steal to the post-battle leader), and
// "the full challenge score is never re-added at resolution" — are structural
// (CAS claim + reading battle_raw_score, never re-scoring) and are spot-checked
// live with concurrent submits, not asserted here.

import {
	computeBattleRanking,
	DEFAULT_BATTLE_LADDER,
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

const L = DEFAULT_BATTLE_LADDER; // [10,7,5,3,1,0]
// Award for a given team_id out of a ranking result.
const awardOf = (r: ReturnType<typeof computeBattleRanking>, id: string) =>
	r.find((e) => e.team_id === id)?.awarded ?? -1;
const rankOf = (r: ReturnType<typeof computeBattleRanking>, id: string) =>
	r.find((e) => e.team_id === id)?.rank ?? -1;

// ── 1: six distinct raws → the ladder maps 1:1 ────────────────────────────────
{
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 20, elapsed: 10 },
		{ teamId: 'B', raw: 15, elapsed: 10 },
		{ teamId: 'C', raw: 10, elapsed: 10 },
		{ teamId: 'D', raw: 5, elapsed: 10 },
		{ teamId: 'E', raw: 2, elapsed: 10 },
		{ teamId: 'F', raw: 1, elapsed: 10 }
	];
	const r = computeBattleRanking(e, L);
	assert('1 A rank1 → 10', [rankOf(r, 'A'), awardOf(r, 'A')], [1, 10]);
	assert('1 B rank2 → 7', [rankOf(r, 'B'), awardOf(r, 'B')], [2, 7]);
	assert('1 C rank3 → 5', [rankOf(r, 'C'), awardOf(r, 'C')], [3, 5]);
	assert('1 F rank6 → 0', [rankOf(r, 'F'), awardOf(r, 'F')], [6, 0]);
}

// ── 2: no-show ranks last of six → 0 ──────────────────────────────────────────
{
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 20, elapsed: 10 },
		{ teamId: 'B', raw: 15, elapsed: 10 },
		{ teamId: 'C', raw: 10, elapsed: 10 },
		{ teamId: 'D', raw: 5, elapsed: 10 },
		{ teamId: 'E', raw: 2, elapsed: 10 },
		{ teamId: 'F', raw: 0, elapsed: Infinity } // no attempt
	];
	const r = computeBattleRanking(e, L);
	assert('2 no-show F rank6 → 0', [rankOf(r, 'F'), awardOf(r, 'F')], [6, 0]);
	assert(
		'2 no-show elapsed recorded null',
		r.find((x) => x.team_id === 'F')?.elapsed_seconds,
		null
	);
}

// ── 3: empty-but-played (raw 0, finite elapsed) ranks ABOVE a no-show ─────────
{
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 10, elapsed: 30 },
		{ teamId: 'B', raw: 0, elapsed: 45 }, // played, empty draft
		{ teamId: 'C', raw: 0, elapsed: Infinity } // never played
	];
	const r = computeBattleRanking(e, L);
	assert('3 played-empty B rank2', rankOf(r, 'B'), 2);
	assert('3 no-show C rank3', rankOf(r, 'C'), 3);
	assert('3 B award (7) > C award (5)', awardOf(r, 'B') > awardOf(r, 'C'), true);
	// Not an exact tie (elapsed differs) → distinct positions, NOT averaged.
	assert('3 B=7 C=5 (distinct, not split)', [awardOf(r, 'B'), awardOf(r, 'C')], [7, 5]);
}

// ── 4: speed tiebreak on equal raw → faster wins, distinct (not averaged) ─────
{
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 15, elapsed: 20 },
		{ teamId: 'B', raw: 15, elapsed: 40 }
	];
	const r = computeBattleRanking(e, L);
	assert('4 faster A rank1 → 10', [rankOf(r, 'A'), awardOf(r, 'A')], [1, 10]);
	assert('4 slower B rank2 → 7', [rankOf(r, 'B'), awardOf(r, 'B')], [2, 7]);
}

// ── 5: exact tie → average-split, clean ((7+5)/2 = 6) ─────────────────────────
{
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 20, elapsed: 10 },
		{ teamId: 'B', raw: 10, elapsed: 15 }, // identical raw+elapsed → tie for ranks 2–3
		{ teamId: 'C', raw: 10, elapsed: 15 }
	];
	const r = computeBattleRanking(e, L);
	assert('5 A rank1 → 10', [rankOf(r, 'A'), awardOf(r, 'A')], [1, 10]);
	assert('5 B tied rank2 → avg 6', [rankOf(r, 'B'), awardOf(r, 'B')], [2, 6]);
	assert('5 C tied rank2 → avg 6', [rankOf(r, 'C'), awardOf(r, 'C')], [2, 6]);
}

// ── 6: exact tie → average-split, rounded ((10+7)/2 = 8.5 → 9, half up) ───────
{
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 12, elapsed: 15 },
		{ teamId: 'B', raw: 12, elapsed: 15 }
	];
	const r = computeBattleRanking(e, L);
	assert('6 A tied rank1 → round(8.5)=9', [rankOf(r, 'A'), awardOf(r, 'A')], [1, 9]);
	assert('6 B tied rank1 → round(8.5)=9', [rankOf(r, 'B'), awardOf(r, 'B')], [1, 9]);
}

// ── 7: two no-shows split the bottom positions ((5+3)/2 = 4) ──────────────────
{
	const e: BattleEntry[] = [
		{ teamId: 'A', raw: 20, elapsed: 10 },
		{ teamId: 'B', raw: 10, elapsed: 10 },
		{ teamId: 'C', raw: 0, elapsed: Infinity }, // no-show
		{ teamId: 'D', raw: 0, elapsed: Infinity } // no-show — exact tie with C
	];
	const r = computeBattleRanking(e, L);
	assert('7 A rank1 → 10', awardOf(r, 'A'), 10);
	assert('7 B rank2 → 7', awardOf(r, 'B'), 7);
	assert('7 C+D tied rank3 → avg (5+3)/2 = 4', [awardOf(r, 'C'), awardOf(r, 'D')], [4, 4]);
	assert('7 C+D share rank 3', [rankOf(r, 'C'), rankOf(r, 'D')], [3, 3]);
}

// ── 8: ladder shorter than the field → overflow positions award 0 ────────────
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
console.log('─── Battle Mode ranking engine (stuk 1) ───');
for (const c of checks) {
	console.log(`  ${c.pass ? '✅' : '❌'} ${c.name.padEnd(44)} ${c.pass ? '' : c.detail}`);
}
const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
console.log(
	'\n(DB-integration: CAS idempotency + batch crown +1 + no-score-re-add — spot-checked live with concurrent submits.)'
);
if (passed !== checks.length) process.exit(1);
