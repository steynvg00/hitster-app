// All Seeing Eye verification — the security strip, the refusal, and the
// show-scores switch.
//
//   npm run bots:verify-all-seeing-eye
//
// READ-ONLY. Part 1 is pure. Parts 2 and 3 issue SELECTs only — they drive the
// REAL resolveAllSeeingEye() against REAL finished submissions in the live
// database, which is the whole point: a restatement of the strip rules would
// prove nothing about what the powerup actually hands out.
//
// What each part proves:
//
//   1. stripAnswersForEye() drops every scoring field, on both stored answer
//      shapes, asserted by walking the OUTPUT for forbidden keys rather than by
//      spot-checking the ones the test happens to remember. Includes the two
//      leaks that are easy to miss — matched_source_track_id (the correct
//      track's uuid) and the legacy track_id — and the fail-closed paths.
//   2. The same strip over real submissions: the raw rows are shown to contain
//      scoring data, and the stripped output is shown not to.
//   3. The refusal (no other finished team → empty list) and the show_scores
//      switch (off → no `score` key at all; on → the score appears).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
	stripAnswersForEye,
	resolveEyeShowScores,
	resolveAllSeeingEye,
	parseConfig
} from '../../src/lib/server/powerups';
import { EYE_DEFAULT_SHOW_SCORES } from '../../src/lib/powerups-meta';
import type { Database } from '../../src/lib/types/database';

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

// ── the forbidden set ─────────────────────────────────────────────────────────
//
// Every key that answers "was this right?". Asserted by WALKING the stripped
// output for any of them at any depth — not by checking the handful a test author
// remembered — so a future field that slips through the allowlist is caught by
// name here rather than by nobody.
const FORBIDDEN_KEYS = [
	'scored',
	'total',
	'breakdown',
	'matched_source_track_id',
	'track_id',
	'status',
	'base',
	'final',
	'streak_bonus',
	'speed_bonus',
	'round_multiplier',
	'comeback_multiplier',
	'difficulty_multiplier',
	'battle_raw_score'
];

/** Every object key appearing anywhere in a structure. */
function allKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
	if (Array.isArray(value)) {
		for (const v of value) allKeys(v, acc);
	} else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			acc.add(k);
			allKeys(v, acc);
		}
	}
	return acc;
}

function forbiddenIn(value: unknown): string[] {
	const keys = allKeys(value);
	return FORBIDDEN_KEYS.filter((k) => keys.has(k));
}

// ── Part 1: the strip, pure ───────────────────────────────────────────────────
function part1() {
	console.log('\n── 1. stripAnswersForEye (pure, no DB) ─────────────────────────');

	// Transcribed from a real row (see part 2) — current TabAnswer[] shape.
	const CURRENT = [
		{
			breakdown: {
				base: 15,
				final: 15,
				speed_bonus: 0,
				streak_bonus: 0,
				round_multiplier: 1,
				comeback_multiplier: 1,
				difficulty_multiplier: 1
			},
			tab_position: 0,
			source_answers: [
				{
					total: 15,
					scored: { year: 5, title: 5, artist: 5 },
					slot_index: 0,
					field_values: { year: '2016', title: 'Legacy', artist: 'D-Sturb\nEmese' },
					matched_source_track_id: 'c1c44717-6982-4ca4-a483-72386f92dd7e'
				}
			]
		}
	];

	// Pre-0036 flat shape, still readable per the note on AnswerArrayEntry.
	const LEGACY = [
		{
			track_id: 'c1c44717-6982-4ca4-a483-72386f92dd7e',
			field_values: { year: '2016', title: 'Legacy', artist: 'Rooler' },
			scored: { year: 5, title: 5, artist: 5 },
			total: 15,
			breakdown: { base: 15, final: 15 }
		}
	];

	console.log('\n current shape');
	const strippedCurrent = stripAnswersForEye(CURRENT);
	console.log('   output:', JSON.stringify(strippedCurrent));
	assert('keeps the typed values', strippedCurrent[0].slots[0].fieldValues, {
		year: '2016',
		title: 'Legacy',
		artist: 'D-Sturb\nEmese'
	});
	assert(
		'keeps tab position + slot index',
		[strippedCurrent[0].tabPosition, strippedCurrent[0].slots[0].slotIndex],
		[0, 0]
	);
	assert('NO forbidden key survives', forbiddenIn(strippedCurrent), []);
	assert(
		'output keys are exactly the allowlist',
		[...allKeys(strippedCurrent)].sort(),
		['fieldValues', 'slotIndex', 'slots', 'tabPosition', 'year', 'title', 'artist'].sort()
	);
	assertTrue(
		'the INPUT really did contain scoring data (so the check means something)',
		forbiddenIn(CURRENT).length > 0,
		`raw row carries: ${forbiddenIn(CURRENT).join(', ')}`
	);

	console.log('\n legacy shape');
	const strippedLegacy = stripAnswersForEye(LEGACY);
	console.log('   output:', JSON.stringify(strippedLegacy));
	assert('keeps the typed values', strippedLegacy[0].slots[0].fieldValues, {
		year: '2016',
		title: 'Legacy',
		artist: 'Rooler'
	});
	assert('NO forbidden key survives (incl. legacy track_id)', forbiddenIn(strippedLegacy), []);
	assertTrue(
		'the legacy INPUT really did contain track_id',
		forbiddenIn(LEGACY).includes('track_id'),
		`raw row carries: ${forbiddenIn(LEGACY).join(', ')}`
	);

	console.log('\n fragments (player input, kept) and numeric values');
	const WITH_FRAGMENTS = [
		{
			tab_position: 0,
			source_answers: [
				{
					total: 0,
					scored: { year: 0 },
					fragments: [2, 1],
					slot_index: 0,
					field_values: { year: 2016, title: 'x' },
					matched_source_track_id: 'aaa'
				}
			]
		}
	];
	const sf = stripAnswersForEye(WITH_FRAGMENTS);
	assert('fragments kept (they are what the team assigned)', sf[0].slots[0].fragments, [2, 1]);
	assert('numeric field value coerced to string', sf[0].slots[0].fieldValues.year, '2016');
	assert('still no forbidden key', forbiddenIn(sf), []);

	console.log('\n fail-closed paths');
	assert('null → empty', stripAnswersForEye(null), []);
	assert('object (not array) → empty', stripAnswersForEye({ field_values: { a: 'b' } }), []);
	assert('string → empty', stripAnswersForEye('nope'), []);
	assert('array of junk → empty', stripAnswersForEye([null, 3, 'x']), []);
	assert(
		'a tab with neither shape contributes nothing',
		stripAnswersForEye([{ tab_position: 0, scored: { a: 1 }, total: 9 }]),
		[]
	);

	console.log('\n resolveEyeShowScores — off unless EXACTLY true');
	assert('absent → default', resolveEyeShowScores(parseConfig({})), EYE_DEFAULT_SHOW_SCORES);
	assert('default is false', EYE_DEFAULT_SHOW_SCORES, false);
	assert(
		'true → true',
		resolveEyeShowScores(parseConfig({ types: { all_seeing_eye: { show_scores: true } } })),
		true
	);
	for (const truthy of ['true', 1, 'yes', {}]) {
		assert(
			`truthy non-boolean ${JSON.stringify(truthy)} → still false`,
			resolveEyeShowScores(parseConfig({ types: { all_seeing_eye: { show_scores: truthy } } })),
			false
		);
	}
}

// ── Part 2 + 3: the real resolver over the real database ──────────────────────
async function part23(sb: SupabaseClient<Database>) {
	console.log('\n── 2. The strip over REAL submissions (read-only SELECT) ───────');

	const { data: subs } = await sb
		.from('submissions')
		.select('id, challenge_id, team_id, score, status, answers')
		.eq('is_final', true)
		.limit(50);

	if (!subs?.length) {
		console.log('  ⚠ SKIPPED — no final submissions in the database');
		return;
	}
	console.log(`  ${subs.length} final submissions sampled`);

	let rawWithScoring = 0;
	const leaked: string[] = [];
	for (const s of subs) {
		if (forbiddenIn(s.answers).length) rawWithScoring++;
		const stripped = stripAnswersForEye(s.answers);
		const bad = forbiddenIn(stripped);
		if (bad.length) leaked.push(`${s.id.slice(0, 8)}: ${bad.join(', ')}`);
	}
	assertTrue(
		'raw rows DO carry scoring data',
		rawWithScoring > 0,
		`${rawWithScoring}/${subs.length} raw rows contain at least one forbidden key`
	);
	assert('stripped output leaks nothing, across every sampled row', leaked, []);

	// Show one before/after in full, so the claim is inspectable rather than asserted.
	const sample = subs.find((s) => forbiddenIn(s.answers).length) ?? subs[0];
	console.log(`\n  before (submission ${sample.id.slice(0, 8)}, raw answers[0]):`);
	console.log('   ' + JSON.stringify((sample.answers as unknown[])?.[0] ?? null).slice(0, 500));
	console.log(`  … plus the row's own status column: ${JSON.stringify(sample.status)}`);
	console.log('\n  after (stripAnswersForEye):');
	console.log('   ' + JSON.stringify(stripAnswersForEye(sample.answers)[0] ?? null).slice(0, 500));

	console.log('\n── 3. resolveAllSeeingEye — refusal + show_scores ──────────────');

	// A challenge that HAS finished submissions, viewed by a team that is NOT the
	// submitter — so the real finished row shows up as "another team" and the whole
	// path is exercised on real data.
	//
	// This detour exists because the live database currently has no challenge where
	// two different teams have both finished, so viewing as one of the submitters
	// would leave the list empty and quietly skip the show_scores checks (which is
	// exactly what an earlier run of this script did). The viewing team is just a
	// parameter, so pointing it at another real team is a faithful exercise of the
	// function, not a stub.
	const withSubs = sample.challenge_id;
	const submitter = sample.team_id;
	const { data: otherTeams } = await sb.from('teams').select('id').neq('id', submitter).limit(1);
	const ownTeam = otherTeams?.[0]?.id ?? submitter;
	if (ownTeam === submitter) {
		console.log('  ⚠ only one team exists — viewing as the submitter, list will be empty');
	} else {
		console.log(`  viewing as ${ownTeam.slice(0, 8)} (not the submitter ${submitter.slice(0, 8)})`);
	}

	const off = await resolveAllSeeingEye(sb, withSubs, ownTeam, false);
	const on = await resolveAllSeeingEye(sb, withSubs, ownTeam, true);

	console.log(`  challenge ${withSubs.slice(0, 8)}, viewing team ${ownTeam.slice(0, 8)}`);
	console.log(`  other finished teams: ${off.length}`);
	for (const t of off) console.log(`    ${t.displayName} (${t.color}) — ${t.tabs.length} tab(s)`);

	assertTrue(
		'never includes the viewing team itself',
		!off.some((t) => t.teamId === ownTeam),
		`own team ${ownTeam.slice(0, 8)} absent from ${off.length} entries`
	);
	assert('resolver output leaks no forbidden key', forbiddenIn(off), []);

	if (off.length) {
		assert(
			'show_scores=false → no `score` key AT ALL (not zero, not null)',
			off.every((t) => !('score' in t)),
			true
		);
		assert(
			'show_scores=true → score present',
			on.every((t) => typeof t.score === 'number'),
			true
		);
		console.log(
			`  with show_scores=true: ${on.map((t) => `${t.displayName}=${t.score}`).join(', ')}`
		);
		console.log('\n  one team as the client would receive it (show_scores=false):');
		console.log('   ' + JSON.stringify(off[0]).slice(0, 600));
	} else {
		console.log('  (no other team finished this challenge — score checks skipped)');
	}

	// The refusal: a challenge where the ONLY finished team is the viewer, or a
	// challenge id nobody has submitted to at all.
	const orphan = '00000000-0000-0000-0000-000000000000';
	const none = await resolveAllSeeingEye(sb, orphan, ownTeam, false);
	assert('challenge nobody finished → empty list (the refusal input)', none, []);

	// Same challenge, but asked from the perspective of every team on it in turn —
	// proves the neq() filter, not just one lucky case.
	const teamsOnChallenge = [
		...new Set(subs.filter((s) => s.challenge_id === withSubs).map((s) => s.team_id))
	];
	let selfLeaks = 0;
	for (const t of teamsOnChallenge) {
		const r = await resolveAllSeeingEye(sb, withSubs, t, false);
		if (r.some((x) => x.teamId === t)) selfLeaks++;
	}
	assert(
		`no team sees itself (checked from all ${teamsOnChallenge.length} team perspectives)`,
		selfLeaks,
		0
	);
}

async function main() {
	loadEnv();
	console.log('All Seeing Eye verification — strip, refusal, show_scores');
	part1();

	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		console.log('\n  ⚠ Parts 2-3 SKIPPED — no PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
	} else {
		await part23(createClient<Database>(url, key));
	}

	const failed = checks.filter((c) => !c.pass);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	if (failed.length) {
		for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
		process.exit(1);
	}
}

main();
