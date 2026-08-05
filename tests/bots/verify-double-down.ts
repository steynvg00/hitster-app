// Double Down verification — the conditional multiplier.
//
//   npm run bots:verify-double-down
//
// Pure-function harness — NO app, NO DB, NO Playwright, NO mutation. Same shape
// as verify-bonus-fields: scoring.ts's runtime dependencies are all client-safe
// ($lib/threshold, $lib/powerups-meta, $lib/artist-tags), so it runs standalone
// under tsx.
//
// Double Down is the first powerup whose multiplier is not knowable when the
// effects are read (deriveEffectModifiers) — it depends on the percentage the
// submission ends up scoring. Two things therefore need proving, and this file
// proves both against the REAL functions rather than a restatement of the rule:
//
//   1. doubleDownMultiplier resolves the bet the way the mechanic specifies.
//   2. computeBreakdown — the single place multipliers are applied — feeds that
//      result into the SAME additive-delta sum as every other multiplier, so a
//      lost bet subtracts from what hard_gaan added instead of compounding.

import { computeBreakdown, type BonusParams } from '../../src/lib/server/scoring';
import { doubleDownMultiplier } from '../../src/lib/powerups-meta';

// ── tiny assert harness ───────────────────────────────────────────────────────
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass ? `${JSON.stringify(got)}` : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
	});
}

// Neutral bonus: difficulty 3 → 1.0×, round 1×, comeback 1.0× (no leader), no
// streak, no speed. Every delta is 0, so the final score isolates double_down.
const neutralBonus = (over: Partial<BonusParams> = {}): BonusParams => ({
	difficulty_rating: 3,
	challenge_multiplier: 1,
	team_score: 0,
	leader_score: 0,
	current_streak: 0,
	streak_thresholds: [],
	elapsed_seconds: null,
	speed_threshold_seconds: null,
	...over
});

// ── 1. the formula itself ─────────────────────────────────────────────────────
console.log('\n── doubleDownMultiplier(g, score%) ──────────────────────────────');
const MATRIX: Array<{ g: number; score: number; want: number }> = [
	{ g: 0, score: 0, want: 1 },
	{ g: 0, score: 50, want: 1 },
	{ g: 0, score: 100, want: 1 },
	{ g: 10, score: 100, want: 1.1 },
	{ g: 10, score: 10, want: 1.1 }, // exactly on target counts as HIT
	{ g: 10, score: 9.9, want: 0.9 },
	{ g: 10, score: 0, want: 0.9 },
	{ g: 80, score: 100, want: 1.8 },
	{ g: 80, score: 80, want: 1.8 },
	{ g: 80, score: 50, want: 0.2 },
	{ g: 100, score: 100, want: 2 },
	{ g: 100, score: 99, want: 0 }
];
// Asserted EXACTLY, with no test-side rounding: this multiplier is persisted in
// submissions.answers[0].breakdown and shown to the team, so a float artifact
// like 0.19999999999999996 is a real defect, not a tolerance question.
for (const { g, score, want } of MATRIX) {
	const got = doubleDownMultiplier(g, score);
	assert(`g=${String(g).padStart(3)} score=${String(score).padStart(5)}% → ×${want}`, got, want);
}

// ── 2. through computeBreakdown (the additive-delta) ──────────────────────────
// base 100, threshold pair = what the team actually scored. This is the real
// entry point: scoreSubmission calls exactly this with {total, max}.
console.log('\n── computeBreakdown: base 100, neutral bonus ────────────────────');
const CASES: Array<{ g: number; total: number; max: number; want: number; note: string }> = [
	{ g: 0, total: 0, max: 100, want: 100, note: 'g=0 no-op even at 0% scored' },
	{ g: 0, total: 100, max: 100, want: 100, note: 'g=0 no-op even at 100% scored' },
	{ g: 10, total: 50, max: 100, want: 110, note: '50% ≥ 10% → hit ×1.1' },
	{ g: 10, total: 5, max: 100, want: 90, note: '5% < 10% → miss ×0.9' },
	{ g: 80, total: 100, max: 100, want: 180, note: '100% ≥ 80% → hit ×1.8' },
	{ g: 80, total: 50, max: 100, want: 20, note: '50% < 80% → miss ×0.2' },
	{ g: 100, total: 99, max: 100, want: 0, note: 'g=100 miss → ×0, floored at 0 never negative' },
	{ g: 50, total: 0, max: 0, want: 100, note: 'thresholdMax=0 → no-op ×1 (documented choice)' }
];
for (const c of CASES) {
	const b = computeBreakdown(100, neutralBonus({ doubleDownPct: c.g }), {
		total: c.total,
		max: c.max
	});
	assert(
		`g=${String(c.g).padStart(3)} ${String(c.total).padStart(3)}/${String(c.max).padEnd(3)} → ${String(c.want).padStart(3)} pts  (${c.note})`,
		b.final,
		c.want
	);
}

// ── 3. the bet is recorded on the breakdown ───────────────────────────────────
console.log('\n── breakdown.double_down (drives the result screen) ─────────────');
const hitB = computeBreakdown(100, neutralBonus({ doubleDownPct: 80 }), { total: 90, max: 100 });
assert('hit: predicted/scored/hit/multiplier', hitB.double_down, {
	predicted_pct: 80,
	score_pct: 90,
	hit: true,
	multiplier: 1.8
});
const missB = computeBreakdown(100, neutralBonus({ doubleDownPct: 80 }), { total: 45, max: 100 });
assert('miss: predicted/scored/hit/multiplier', missB.double_down, {
	predicted_pct: 80,
	score_pct: 45,
	hit: false,
	multiplier: 0.2
});
const zeroMaxB = computeBreakdown(100, neutralBonus({ doubleDownPct: 50 }), { total: 0, max: 0 });
assert('thresholdMax=0 records a ×1 no-op', zeroMaxB.double_down?.multiplier, 1);

// ── 4. stacking: ONE sum, not a × layer on top ────────────────────────────────
// The whole point of the additive-delta. hard_gaan contributes +0.5, a lost
// g=80 bet contributes −0.8 → Σ = −0.3 → ×0.7. Chain-multiplying instead would
// give 100 × 1.5 × 0.2 = 30, which is what this rules out.
console.log('\n── stacking with hard_gaan / single_event_mult ──────────────────');
const stackMiss = computeBreakdown(
	100,
	neutralBonus({ doubleDownPct: 80, extraMultipliers: [1.5] }),
	{ total: 50, max: 100 }
);
assert('hard_gaan 1.5 + lost g=80 → 1+0.5−0.8 = 0.7 → 70 pts (NOT 30)', stackMiss.final, 70);

const stackHit = computeBreakdown(
	100,
	neutralBonus({ doubleDownPct: 80, extraMultipliers: [1.5] }),
	{ total: 100, max: 100 }
);
assert('hard_gaan 1.5 + won g=80 → 1+0.5+0.8 = 2.3 → 230 pts (NOT 270)', stackHit.final, 230);

const stackTriple = computeBreakdown(
	100,
	neutralBonus({ doubleDownPct: 20, extraMultipliers: [1.5, 1.5], difficulty_rating: 5 }),
	{ total: 100, max: 100 }
);
// 1 + (1.667−1) + 0 + 0 + 0.5 + 0.5 + 0.2 = 2.867 → 287
assert('difficulty 5 + hard_gaan + single_event + won g=20 → 287 pts', stackTriple.final, 287);

// ── 5. no bet → nothing changes ───────────────────────────────────────────────
// The guarantee that non-Double-Down submissions are untouched.
console.log('\n── no double_down present (regression guard) ───────────────────');
const plain = computeBreakdown(100, neutralBonus(), { total: 50, max: 100 });
assert('no bet: final unchanged', plain.final, 100);
assert('no bet: no double_down key on breakdown', plain.double_down, undefined);
const plainNoThreshold = computeBreakdown(100, neutralBonus());
assert('no bet, no threshold arg at all: final unchanged', plainNoThreshold.final, 100);
const plainStack = computeBreakdown(100, neutralBonus({ extraMultipliers: [1.5] }), {
	total: 50,
	max: 100
});
assert('no bet + hard_gaan: still 150', plainStack.final, 150);

// ── report ────────────────────────────────────────────────────────────────────
console.log('');
for (const c of checks) {
	console.log(`  ${c.pass ? '✅' : '❌'} ${c.name.padEnd(64)} ${c.pass ? '' : c.detail}`);
}
const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed\n`);
process.exit(passed === checks.length ? 0 : 1);
