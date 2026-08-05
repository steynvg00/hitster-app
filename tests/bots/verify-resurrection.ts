// Resurrection verification — the difference arithmetic, the 1/3 clock, and the
// state the retry actually leaves behind.
//
//   npm run bots:verify-resurrection
//
// READ-ONLY. Parts 1 and 2 are pure (no DB, no app). Part 3 issues SELECTs only
// — it reads the catalog row, the per-attempt clock column and any live ticket,
// and writes nothing at all.
//
// What each part proves:
//
//   1. The settlement arithmetic, which is the whole no-double-count claim.
//      resurrectionDelta is what moves the team score, so the assertions are
//      written as team totals, not as bare differences: a team on S points with
//      an old submission worth `old` must end on S - old + new under 'replace',
//      and never below S under 'best'.
//   2. The retry clock: exactly a third, rounded, floored at 1s, and null for an
//      untimed challenge (nothing to divide).
//   3. The live catalog row and the schema the retry needs, plus a report of any
//      open ticket. Needs migration 0074 to have been applied; says so and skips
//      rather than reporting a false pass.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
	resurrectionDelta,
	resurrectionRetrySeconds,
	RESURRECTION_TIMER_FRACTION
} from '../../src/lib/powerups-meta';
import { resolveResurrectionScoreMode, submissionFinalScore } from '../../src/lib/server/powerups';
import { parseConfig } from '../../src/lib/server/powerups';

// ── .env loader (only sets keys not already in the environment) ───────────────
function loadEnv() {
	try {
		const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
		for (const line of raw.split('\n')) {
			const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
			if (!m) continue;
			let val = m[2].trim();
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
				val = val.slice(1, -1);
			if (!(m[1] in process.env)) process.env[m[1]] = val;
		}
	} catch {
		/* no .env — rely on the real environment */
	}
}

// ── tiny assert harness ───────────────────────────────────────────────────────
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass ? JSON.stringify(got) : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
	});
	console.log(`  ${pass ? '✓' : '✗'} ${name}  ${checks[checks.length - 1].detail}`);
}
function assertTrue(name: string, cond: boolean, detail: string) {
	checks.push({ name, pass: cond, detail });
	console.log(`  ${cond ? '✓' : '✗'} ${name}  ${detail}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — the settlement
// ─────────────────────────────────────────────────────────────────────────────
//
// The model, exactly as src/lib/server/submit.ts implements it:
//
//   teams.score already CONTAINS old_final (the first submission put it there).
//   The retry books resurrectionDelta(old, new, mode) onto that same total, in
//   one update. So the honest assertion is about where the team ENDS UP.
//
// The double-count this guards against is `score + old + new`, which is what an
// ordinary submit would have produced on the re-opened row. Every case below
// states the team total, so that failure mode cannot pass unnoticed.
function settle(
	teamScoreBefore: number,
	oldFinal: number,
	newFinal: number,
	mode: 'replace' | 'best'
) {
	return teamScoreBefore + resurrectionDelta(oldFinal, newFinal, mode);
}

function part1() {
	console.log('\n[1] settlement — the difference, booked once');

	// The brief's two worked examples.
	assert('replace: old 40 → new 60 books +20', resurrectionDelta(40, 60, 'replace'), 20);
	assert('replace: old 60 → new 40 books -20', resurrectionDelta(60, 40, 'replace'), -20);
	assert('best:    old 40 → new 60 books +20', resurrectionDelta(40, 60, 'best'), 20);
	assert('best:    old 60 → new 40 books +0', resurrectionDelta(60, 40, 'best'), 0);

	// The same four as team totals. A team on 100 whose old submission was worth
	// 40 must land on 120 when the retry scores 60 — NOT on 160 (old kept and new
	// added, the double-count) and not on 60 (a rollback that also dropped the
	// rest of the team's game).
	assert('replace: 100 (incl. old 40) → retry 60 → 120', settle(100, 40, 60, 'replace'), 120);
	assertTrue(
		'replace: never lands on the double-counted total',
		settle(100, 40, 60, 'replace') !== 100 + 40 + 60,
		`120 ≠ ${100 + 40 + 60}`
	);
	assert('replace: 100 (incl. old 60) → retry 40 → 80', settle(100, 60, 40, 'replace'), 80);
	assert('best:    100 (incl. old 60) → retry 40 → 100', settle(100, 60, 40, 'best'), 100);
	assert('best:    100 (incl. old 40) → retry 60 → 120', settle(100, 40, 60, 'best'), 120);

	// Equal scores are a no-op under both modes — a team that replays a challenge
	// and does exactly as well must see its total unchanged.
	assert('replace: identical retry moves nothing', resurrectionDelta(55, 55, 'replace'), 0);
	assert('best:    identical retry moves nothing', resurrectionDelta(55, 55, 'best'), 0);

	// Abandoning a retry: the backstop scores an empty draft, i.e. new = 0.
	assert('replace: abandoned retry costs the original', resurrectionDelta(40, 0, 'replace'), -40);
	assert('best:    abandoned retry costs nothing', resurrectionDelta(40, 0, 'best'), 0);

	// From zero — resurrecting a challenge the team blanked. Both modes agree,
	// because there is nothing to lose.
	assert('replace: old 0 → new 35 books +35', resurrectionDelta(0, 35, 'replace'), 35);
	assert('best:    old 0 → new 35 books +35', resurrectionDelta(0, 35, 'best'), 35);

	// 'best' can never reduce a score, whatever the pair. Swept rather than
	// argued.
	let bestNegative = 0;
	for (let old = 0; old <= 120; old += 3) {
		for (let nw = 0; nw <= 120; nw += 3) {
			if (resurrectionDelta(old, nw, 'best') < 0) bestNegative++;
		}
	}
	assert("'best' is never negative (41×41 sweep)", bestNegative, 0);

	// …and 'replace' always lands the team exactly on "as if the retry had been
	// the first attempt". Same sweep, stated as the invariant it is.
	let replaceWrong = 0;
	for (let old = 0; old <= 120; old += 3) {
		for (let nw = 0; nw <= 120; nw += 3) {
			if (settle(500, old, nw, 'replace') !== 500 - old + nw) replaceWrong++;
		}
	}
	assert("'replace' == score - old + new (41×41 sweep)", replaceWrong, 0);

	// The score-mode resolver: only the exact string 'best' switches modes, for
	// the same reason the Eye's show_scores demands exactly `true`.
	assert('score_mode default', resolveResurrectionScoreMode(parseConfig({})), 'replace');
	assert(
		'score_mode best',
		resolveResurrectionScoreMode(parseConfig({ types: { resurrection: { score_mode: 'best' } } })),
		'best'
	);
	assert(
		'score_mode garbage → replace',
		resolveResurrectionScoreMode(parseConfig({ types: { resurrection: { score_mode: 'BEST' } } })),
		'replace'
	);

	// old_final is read from breakdown.final — the exact number the first
	// submission added to the team score — with documented fallbacks.
	assert(
		'old_final from breakdown.final',
		submissionFinalScore({ answers: [{ breakdown: { final: 47 } }], score: 999 }),
		47
	);
	assert(
		'old_final falls back to submissions.score',
		submissionFinalScore({ answers: [{}], score: 31 }),
		31
	);
	assert('old_final of a blank submission', submissionFinalScore({ answers: [], score: null }), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — the retry clock
// ─────────────────────────────────────────────────────────────────────────────
function part2() {
	console.log('\n[2] the 1/3 clock');

	assert('fraction is a third', RESURRECTION_TIMER_FRACTION, 1 / 3);
	assert('180s → 60s', resurrectionRetrySeconds(180), 60);
	assert('90s → 30s', resurrectionRetrySeconds(90), 30);
	assert('60s → 20s', resurrectionRetrySeconds(60), 20);
	assert('45s → 15s', resurrectionRetrySeconds(45), 15);
	// Rounding, not truncation: 100/3 = 33.33 → 33, 50/3 = 16.67 → 17.
	assert('100s → 33s (rounded)', resurrectionRetrySeconds(100), 33);
	assert('50s → 17s (rounded up)', resurrectionRetrySeconds(50), 17);
	// The floor. Without it a 1s challenge would produce a 0s attempt — one the
	// auto-submit sweep closes on its first pass, i.e. a Tier S powerup spent on
	// a clock that never ran.
	assert('2s → 1s (floored)', resurrectionRetrySeconds(2), 1);
	assert('1s → 1s (floored)', resurrectionRetrySeconds(1), 1);
	// Untimed: nothing to divide.
	assert('0s → null (untimed)', resurrectionRetrySeconds(0), null);
	assert('null → null (untimed)', resurrectionRetrySeconds(null), null);
	assert('undefined → null', resurrectionRetrySeconds(undefined), null);

	// Never longer than the original, and never zero on a timed challenge — the
	// two properties the mechanic depends on, swept.
	let violations = 0;
	for (let s = 1; s <= 3600; s++) {
		const r = resurrectionRetrySeconds(s);
		if (r === null || r < 1 || r > s) violations++;
	}
	assert('1..3600s: always 1..original (sweep)', violations, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 3 — the live catalog and schema (SELECT only)
// ─────────────────────────────────────────────────────────────────────────────
async function part3() {
	console.log('\n[3] live catalog + schema (read-only)');

	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		assertTrue(
			'database reachable',
			false,
			'PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset'
		);
		return;
	}
	const db = createClient(url, key, { auth: { persistSession: false } });

	const { data: row, error } = await db
		.from('powerup_types')
		.select('*')
		.eq('id', 'resurrection')
		.maybeSingle();

	if (error) {
		assertTrue('powerup_types readable', false, error.message);
		return;
	}
	if (!row) {
		console.log('  → no resurrection row: migration 0074 has not been run yet. Skipping part 3.');
		return;
	}

	const r = row as Record<string, unknown>;
	assert('catalog: coming_soon', r.coming_soon, false);
	assert('catalog: enabled_by_default', r.enabled_by_default, true);
	assert('catalog: holdable', r.holdable, true);
	assert('catalog: immediate_use', r.immediate_use, false);
	assert('catalog: tier', r.tier, 'S');
	assert('catalog: category', r.category, 'defensive');
	assert('catalog: default_inverse', r.default_inverse, false);

	// The per-attempt clock column. Selecting it is the check: without migration
	// 0074 the column does not exist and PostgREST refuses the query, which is a
	// real failure rather than a skip — the catalog row above proved 0074 ran.
	const { error: colErr } = await db
		.from('challenge_attempts')
		.select('id, timer_override_seconds')
		.limit(1);
	assertTrue(
		'challenge_attempts.timer_override_seconds exists',
		!colErr,
		colErr?.message ?? 'column present'
	);

	// Any retry currently in flight. Reported, not asserted — this is a live
	// database and an open ticket is a legitimate state (someone is playing).
	const { data: tickets } = await db
		.from('team_effects')
		.select('team_id, payload, activated_at')
		.eq('effect_type', 'resurrection')
		.is('consumed_at', null);
	console.log(
		`  · open tickets right now: ${tickets?.length ?? 0}` +
			(tickets?.length
				? ` → ${tickets
						.map((t) => {
							const p = (t.payload ?? {}) as Record<string, unknown>;
							return `team ${String(t.team_id).slice(0, 8)} old_final=${p.old_final} mode=${p.score_mode}`;
						})
						.join(', ')}`
				: '')
	);

	// An unlocked submission with NO ticket is the one state that would let a
	// re-submit double-count. It should never exist: the activation writes the
	// ticket first and rolls it back if the unlock fails.
	const { data: unlocked } = await db
		.from('submissions')
		.select('challenge_id, team_id')
		.eq('is_final', false);
	const ticketKeys = new Set(
		(tickets ?? []).map(
			(t) => `${t.team_id}|${((t.payload ?? {}) as Record<string, unknown>).challenge_id}`
		)
	);
	const orphans = (unlocked ?? []).filter((s) => !ticketKeys.has(`${s.team_id}|${s.challenge_id}`));
	assert('no unlocked submission without a ticket', orphans.length, 0);
}

async function main() {
	loadEnv();
	console.log('Resurrection verification — difference, clock, catalog');
	part1();
	part2();
	await part3();

	const failed = checks.filter((c) => !c.pass);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	if (failed.length) {
		for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
		process.exit(1);
	}
}

main();
