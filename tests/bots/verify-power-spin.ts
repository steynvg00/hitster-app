// Power Spin verification — the weighted tier roll, the exclusions, and the
// empty-tier fallback.
//
//   npm run bots:verify-power-spin
//
// READ-ONLY. Part 1 is pure (no DB, no app). Part 2 issues a single SELECT
// against powerup_types and runs the REAL roll over the REAL catalog.
//
// What each part proves:
//
//   1. The roll, against a fixture catalog that is a transcription of migration
//      0072's tier assignment. Pinned RNG at both edges of the A/S split; the
//      pool excludes power_spin, coming_soon types and types a set has switched
//      off; an empty Tier S falls back to Tier A rather than throwing or
//      returning nothing; both tiers empty returns a null pick (the caller's
//      "empty wheel" path) instead of an exception.
//   2. The same roll over the live catalog, plus a distribution sweep: the
//      observed S share tracks the configured chance, and power_spin never
//      appears in an outcome across many thousands of rolls.
//
// Part 2 needs migration 0072 to have been applied. If powerup_types has no
// `tier` column yet it says so and skips, rather than reporting a false pass.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
	pickSpinType,
	rollSpinTier,
	resolveSpinTierSChance,
	spinPoolForTier,
	parseConfig,
	type PowerupType
} from '../../src/lib/server/powerups';
import { POWER_SPIN_DEFAULT_TIER_S_CHANCE } from '../../src/lib/powerups-meta';

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

// ── deterministic RNG (mulberry32) ───────────────────────────────────────────
// A seeded generator rather than Math.random so a failure here reproduces
// exactly. `seq` is the other tool: a scripted list of draws for pinning one
// specific path through the roll (pickSpinType draws twice — tier, then index).
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function seq(...values: number[]): () => number {
	let i = 0;
	return () => values[Math.min(i++, values.length - 1)];
}

// ── fixture catalog: migration 0072's tier assignment, transcribed ───────────
function t(id: string, tier: 'S' | 'A' | 'B' | 'C' | 'D', category: string): PowerupType {
	return {
		id,
		name: id,
		category,
		description: null,
		immediate_use: false,
		holdable: true,
		default_min_score_pct: 0,
		default_max_score_pct: 100,
		sort_order: 0,
		icon: null,
		enabled_by_default: true,
		coming_soon: false,
		default_inverse: false,
		tier,
		created_at: ''
	} as unknown as PowerupType;
}

// Exactly the 17 rows migration 0072 assigns a tier to, plus power_spin.
const FIXTURE: PowerupType[] = [
	t('free_tab', 'A', 'information'),
	t('double_down', 'A', 'defensive'),
	t('freeze', 'A', 'offensive'),
	t('time_drain', 'A', 'offensive'),
	t('power_spin', 'A', 'self'),
	t('x_ray', 'B', 'information'),
	t('lifeline', 'B', 'defensive'),
	t('insurance', 'B', 'defensive'),
	t('shield', 'B', 'defensive'),
	t('time_boost', 'B', 'defensive'),
	t('free_answer', 'C', 'information'),
	t('lucky_dice', 'C', 'self'),
	t('bonus_points', 'C', 'self'),
	t('hard_gaan', 'C', 'self'),
	t('give_a_shot', 'C', 'social'),
	t('tap_to_break', 'C', 'offensive'),
	t('single_event_mult', 'C', 'self'),
	t('penalty_shot', 'D', 'punishment')
];

// The same catalog once the two Tier S powerups exist — used to prove the S
// branch actually reaches them, which the live catalog cannot show yet.
const FIXTURE_WITH_S: PowerupType[] = [
	...FIXTURE,
	t('resurrection', 'S', 'defensive'),
	t('all_seeing_eye', 'S', 'information')
];

const EMPTY_CFG = parseConfig({});

function idsOf(types: PowerupType[]): string[] {
	return types.map((x) => x.id).sort();
}

// ── Part 1: the roll, pure ───────────────────────────────────────────────────
function part1() {
	console.log('\n── 1. The roll (pure, no DB) ───────────────────────────────────');

	console.log('\n resolveSpinTierSChance — a setting, not a constant');
	assert('absent → default', resolveSpinTierSChance(EMPTY_CFG), POWER_SPIN_DEFAULT_TIER_S_CHANCE);
	assert('default is the designed 85/15', POWER_SPIN_DEFAULT_TIER_S_CHANCE, 0.15);
	assert(
		'per-set override honoured',
		resolveSpinTierSChance(parseConfig({ types: { power_spin: { tier_s_chance: 0.4 } } })),
		0.4
	);
	for (const bad of [-0.1, 1.5, Number.NaN, 'x', null]) {
		assert(
			`invalid ${JSON.stringify(bad)} → default`,
			resolveSpinTierSChance(parseConfig({ types: { power_spin: { tier_s_chance: bad } } })),
			POWER_SPIN_DEFAULT_TIER_S_CHANCE
		);
	}

	console.log('\n rollSpinTier — pinned at both edges of the 0.15 split');
	assert('draw 0.00 → S', rollSpinTier(0.15, seq(0.0)), 'S');
	assert('draw 0.1499 → S', rollSpinTier(0.15, seq(0.1499)), 'S');
	assert('draw 0.15 → A (boundary is exclusive)', rollSpinTier(0.15, seq(0.15)), 'A');
	assert('draw 0.99 → A', rollSpinTier(0.15, seq(0.99)), 'A');
	assert('chance 0 → never S', rollSpinTier(0, seq(0.0)), 'A');
	assert('chance 1 → always S', rollSpinTier(1, seq(0.999)), 'S');

	console.log('\n spinPoolForTier — the exclusions');
	assert(
		'Tier A pool excludes power_spin',
		idsOf(spinPoolForTier(EMPTY_CFG, FIXTURE, 'A')),
		['double_down', 'free_tab', 'freeze', 'time_drain'].sort()
	);
	assert('Tier S pool is empty today', idsOf(spinPoolForTier(EMPTY_CFG, FIXTURE, 'S')), []);
	assert(
		'Tier S pool once built',
		idsOf(spinPoolForTier(EMPTY_CFG, FIXTURE_WITH_S, 'S')),
		['all_seeing_eye', 'resurrection'].sort()
	);
	assert(
		'coming_soon type is not spinnable',
		idsOf(
			spinPoolForTier(
				EMPTY_CFG,
				FIXTURE.map((x) => (x.id === 'freeze' ? { ...x, coming_soon: true } : x)),
				'A'
			)
		),
		['double_down', 'free_tab', 'time_drain'].sort()
	);
	assert(
		'a type this set disabled is not spinnable',
		idsOf(spinPoolForTier(parseConfig({ types: { free_tab: { enabled: false } } }), FIXTURE, 'A')),
		['double_down', 'freeze', 'time_drain'].sort()
	);
	assert(
		'a category this set switched off is not spinnable',
		idsOf(spinPoolForTier(parseConfig({ categories: { offensive: false } }), FIXTURE, 'A')),
		['double_down', 'free_tab'].sort()
	);

	console.log('\n pickSpinType — pinned outcomes');
	// Draw 1 picks the tier, draw 2 indexes the pool.
	const aPool = spinPoolForTier(EMPTY_CFG, FIXTURE, 'A');
	assert(
		'roll A, index 0 → first of the A pool',
		pickSpinType(EMPTY_CFG, FIXTURE, seq(0.99, 0.0)).type?.id,
		aPool[0].id
	);
	assert(
		'roll A, index at the top → last of the A pool',
		pickSpinType(EMPTY_CFG, FIXTURE, seq(0.99, 0.999)).type?.id,
		aPool[aPool.length - 1].id
	);
	const sHit = pickSpinType(EMPTY_CFG, FIXTURE_WITH_S, seq(0.01, 0.0));
	assert('roll S with S populated → an S type', sHit.type?.tier, 'S');
	assert('  … and usedTier says S', [sHit.rolledTier, sHit.usedTier], ['S', 'S']);

	console.log('\n empty-tier fallback');
	const fell = pickSpinType(EMPTY_CFG, FIXTURE, seq(0.01, 0.0));
	assert('rolled S on an empty Tier S → still returns a type', fell.type !== null, true);
	assert('  … the type came from Tier A', fell.type?.tier, 'A');
	assert(
		'  … rolledTier=S, usedTier=A (the fallback is visible)',
		[fell.rolledTier, fell.usedTier],
		['S', 'A']
	);
	const noneAtAll = pickSpinType(
		parseConfig({ categories: { information: false, defensive: false, offensive: false } }),
		FIXTURE,
		seq(0.01, 0.0)
	);
	assert('every tier empty → null pick, no throw', noneAtAll.type, null);
	assert('  … usedTier null', noneAtAll.usedTier, null);

	console.log('\n distribution + the recursion guard, over 20 000 rolls');
	for (const chance of [0.15, 0.4]) {
		const cfg = parseConfig({ types: { power_spin: { tier_s_chance: chance } } });
		const rand = mulberry32(20260805);
		let sCount = 0;
		let spunSelf = 0;
		const seen = new Set<string>();
		const N = 20000;
		for (let i = 0; i < N; i++) {
			const p = pickSpinType(cfg, FIXTURE_WITH_S, rand);
			if (p.rolledTier === 'S') sCount++;
			if (p.type) {
				seen.add(p.type.id);
				if (p.type.id === 'power_spin') spunSelf++;
			}
		}
		const observed = sCount / N;
		assertTrue(
			`S share ≈ ${chance} (observed ${observed.toFixed(4)})`,
			Math.abs(observed - chance) < 0.015,
			`|${observed.toFixed(4)} − ${chance}| < 0.015`
		);
		assert(`power_spin never rolled (chance ${chance})`, spunSelf, 0);
		assert(
			`outcomes stay inside Tier A/S (chance ${chance})`,
			[...seen].sort(),
			['all_seeing_eye', 'double_down', 'free_tab', 'freeze', 'resurrection', 'time_drain'].sort()
		);
	}
}

// ── Part 2: the same roll over the live catalog ──────────────────────────────
async function part2() {
	console.log('\n── 2. The live catalog (read-only SELECT) ──────────────────────');

	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		console.log('  ⚠ SKIPPED — no PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
		return;
	}
	const sb = createClient(url, key);
	const { data, error } = await sb.from('powerup_types').select('*');
	if (error) {
		console.log(`  ⚠ SKIPPED — ${error.message}`);
		return;
	}
	const live = (data ?? []) as unknown as PowerupType[];
	if (!live.length || !('tier' in (live[0] as object))) {
		console.log('  ⚠ SKIPPED — powerup_types has no `tier` column yet.');
		console.log('    Run supabase/migrations/0072_power_spin_and_tiers.sql, then re-run this.');
		return;
	}

	console.log(`  catalog: ${live.length} types`);
	const byTier: Record<string, string[]> = {};
	for (const x of live) (byTier[x.tier] ??= []).push(x.id);
	for (const tier of ['S', 'A', 'B', 'C', 'D'])
		console.log(`    ${tier}: ${(byTier[tier] ?? []).sort().join(', ') || '(empty)'}`);

	const cfg = parseConfig({});
	console.log('\n  pool');
	assert(
		'live Tier A pool excludes power_spin',
		idsOf(spinPoolForTier(cfg, live, 'A')).includes('power_spin'),
		false
	);
	console.log(`    Tier A spin pool: ${idsOf(spinPoolForTier(cfg, live, 'A')).join(', ')}`);
	console.log(
		`    Tier S spin pool: ${idsOf(spinPoolForTier(cfg, live, 'S')).join(', ') || '(empty)'}`
	);

	console.log('\n  20 000 rolls over the live catalog');
	const rand = mulberry32(4242);
	const counts: Record<string, number> = {};
	let sRolled = 0;
	let nullPicks = 0;
	const N = 20000;
	for (let i = 0; i < N; i++) {
		const p = pickSpinType(cfg, live, rand);
		if (p.rolledTier === 'S') sRolled++;
		if (!p.type) nullPicks++;
		else counts[p.type.id] = (counts[p.type.id] ?? 0) + 1;
	}
	for (const [id, n] of Object.entries(counts).sort((a, b) => b[1] - a[1]))
		console.log(`    ${id.padEnd(20)} ${n} (${((n / N) * 100).toFixed(1)}%)`);
	assert('power_spin never in the outcome', counts.power_spin ?? 0, 0);
	assert('no null pick (Tier A is populated)', nullPicks, 0);
	assertTrue(
		`S rolled ≈ 15% (observed ${((sRolled / N) * 100).toFixed(1)}%) and all fell back to A`,
		Math.abs(sRolled / N - 0.15) < 0.015,
		`${sRolled}/${N} rolls asked for S; Tier S is empty so each landed in A`
	);
	const outsideAS = Object.keys(counts).filter(
		(id) => !['A', 'S'].includes(live.find((x) => x.id === id)?.tier ?? '')
	);
	assert('every outcome is Tier A or S', outsideAS, []);
}

async function main() {
	loadEnv();
	console.log('Power Spin verification — roll, exclusions, fallback');
	part1();
	await part2();

	const failed = checks.filter((c) => !c.pass);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	if (failed.length) {
		for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
		process.exit(1);
	}
}

main();
