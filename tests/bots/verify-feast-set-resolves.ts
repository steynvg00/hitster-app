// Read-only verification: the feast set ("Vrienden Weekend 2026") RESOLVES to
// the designed per-type powerup values even though its STORED powerup_config is
// still stripped.
//
//   npm run bots:verify-feast-set-resolves
//
// ── Why this bot exists ─────────────────────────────────────────────────────
//
// The wholesale-overwrite landmine (fixed in "Fix/powerup config merge safe",
// PR #79) had already stripped Vrienden Weekend 2026's powerup_config down to
// {"thresholds_percent":[25,50,75]} — the five per-type seeds that migrations
// 0070–0074 wrote were gone. The fix is a CODE fallback on the READ side: each
// per-type resolver falls back to a code constant when the stored key is
// absent. The raw DB row is deliberately NOT repaired, so the only thing that
// makes that set correct is the resolver path. This bot pins exactly that:
//
//   1. PREMISE — the raw row is still stripped (no types subtree). If someone
//      later "fixes" the row by hand, this check flags that the bot is no
//      longer testing the fallback path.
//   2. RESOLVED — parseConfig() + the six per-type resolvers (the REAL read
//      path every runtime call site uses: parseConfig at powerups.ts:73, then
//      resolveTypeChance :698 / resolveDiceRange :235 / resolveXrayBudget :267
//      / resolveSpinTierSChance :555 / resolveEyeShowScores :382 /
//      resolveResurrectionScoreMode :398) must yield the designed defaults.
//   3. CONTRAST — a healthy set that still carries the migration seeds must
//      resolve to the SAME values through the seed path, proving stripped and
//      healthy sets are indistinguishable after resolution.
//
// ── Oracle (independent of the resolver code) ───────────────────────────────
//
// The expected values below are hand-copied from the DESIGN — the migration
// seed literals, not from any constant powerups.ts exports:
//
//   lifeline.chance        0.5        0071_enable_lifeline.sql:123
//   lucky_dice.dice_min    1          0070_enable_group_a_powerups.sql:117
//   lucky_dice.dice_max    6          0070_enable_group_a_powerups.sql:117
//   x_ray.reveal_budget    5          never seeded — design value (X-Ray is
//                                     worth 5 reveals; 0072's header describes
//                                     reveal_budget as config-tunable with 5
//                                     as the designed budget)
//   power_spin.tier_s_chance 0.15     0072_power_spin_and_tiers.sql:170
//   all_seeing_eye.show_scores false  0073_enable_all_seeing_eye.sql:111
//   resurrection.score_mode 'replace' 0074_enable_resurrection.sql:151
//
// ── Falsifiability ──────────────────────────────────────────────────────────
//
// Verified to have teeth (the mutation-review lesson): temporarily setting
// EXPECTED.lifeline_chance to 1.0 — the exact bug this bot fears, lifeline
// dropping at double rate — turned the run red with
//   FAIL feast: lifeline chance  got 0.5 want 1
// before the expectation was restored. The bot is not a vacuum check.
//
// Read-only: two SELECTs on game_sets. No INSERT/UPDATE/DELETE anywhere.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
	parseConfig,
	resolveTypeChance,
	resolveDiceRange,
	resolveXrayBudget,
	resolveSpinTierSChance,
	resolveEyeShowScores,
	resolveResurrectionScoreMode
} from '../../src/lib/server/powerups';

// ── the oracle: designed values, hand-copied from the migration seeds ────────
const EXPECTED = {
	lifeline_chance: 0.5, // NOT 1.0 — 1.0 is the double-rate bug
	dice_min: 1,
	dice_max: 6,
	x_ray_reveal_budget: 5,
	power_spin_tier_s_chance: 0.15,
	all_seeing_eye_show_scores: false,
	resurrection_score_mode: 'replace'
} as const;

const FEAST_SET_NAME_PREFIX = 'Vrienden Weekend 2026';

// ── env + client (same pattern as verify-earning.ts) ─────────────────────────
function loadEnv(): void {
	const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
	for (const line of raw.split('\n')) {
		const m = line.match(/^([A-Z_]+)=(.*)$/);
		if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
	}
}

// ── tiny assert harness (same shape as verify-config-merge-safe.ts) ──────────
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	const detail = pass
		? JSON.stringify(got)
		: `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`;
	checks.push({ name, pass, detail });
}

type ResolvedStrengths = {
	lifeline_chance: number;
	dice_min: number;
	dice_max: number;
	x_ray_reveal_budget: number;
	power_spin_tier_s_chance: number;
	all_seeing_eye_show_scores: boolean;
	resurrection_score_mode: string;
};

/**
 * The REAL read path, exactly as the runtime call sites do it: parseConfig on
 * the raw jsonb, then each per-type resolver. This is what makes the run a
 * fallback test rather than a raw-jsonb readback.
 */
function resolveStrengths(rawConfig: unknown): ResolvedStrengths {
	const cfg = parseConfig(rawConfig);
	const dice = resolveDiceRange(cfg);
	return {
		lifeline_chance: resolveTypeChance(cfg, 'lifeline'),
		dice_min: dice.min,
		dice_max: dice.max,
		x_ray_reveal_budget: resolveXrayBudget(cfg),
		power_spin_tier_s_chance: resolveSpinTierSChance(cfg),
		all_seeing_eye_show_scores: resolveEyeShowScores(cfg),
		resurrection_score_mode: resolveResurrectionScoreMode(cfg)
	};
}

function assertStrengths(label: string, got: ResolvedStrengths) {
	assert(`${label}: lifeline chance`, got.lifeline_chance, EXPECTED.lifeline_chance);
	assert(`${label}: dice_min`, got.dice_min, EXPECTED.dice_min);
	assert(`${label}: dice_max`, got.dice_max, EXPECTED.dice_max);
	assert(`${label}: x_ray reveal_budget`, got.x_ray_reveal_budget, EXPECTED.x_ray_reveal_budget);
	assert(
		`${label}: power_spin tier_s_chance`,
		got.power_spin_tier_s_chance,
		EXPECTED.power_spin_tier_s_chance
	);
	assert(
		`${label}: all_seeing_eye show_scores`,
		got.all_seeing_eye_show_scores,
		EXPECTED.all_seeing_eye_show_scores
	);
	assert(
		`${label}: resurrection score_mode`,
		got.resurrection_score_mode,
		EXPECTED.resurrection_score_mode
	);
}

/** True if the raw jsonb still carries the lifeline seed (i.e. NOT stripped). */
function hasLifelineSeed(rawConfig: unknown): boolean {
	if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return false;
	const types = (rawConfig as Record<string, unknown>).types;
	if (!types || typeof types !== 'object' || Array.isArray(types)) return false;
	const lifeline = (types as Record<string, unknown>).lifeline;
	if (!lifeline || typeof lifeline !== 'object') return false;
	return typeof (lifeline as Record<string, unknown>).chance === 'number';
}

async function main() {
	loadEnv();
	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		throw new Error('Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
	}
	const db = createClient(url, key, { auth: { persistSession: false } });

	// One read-only SELECT: every set's name + raw config.
	const { data: sets, error } = await db
		.from('game_sets')
		.select('id, name, powerup_config')
		.order('created_at', { ascending: true });
	if (error) throw new Error(`game_sets select failed: ${error.message}`);
	if (!sets?.length) throw new Error('No game_sets rows found');

	// ── the feast set ──────────────────────────────────────────────────────────
	const feast = sets.find((s) => s.name?.startsWith(FEAST_SET_NAME_PREFIX));
	if (!feast) throw new Error(`No set named "${FEAST_SET_NAME_PREFIX}…" found`);

	console.log(`Feast set: ${feast.name} (${feast.id})`);
	console.log(`  raw powerup_config: ${JSON.stringify(feast.powerup_config)}`);

	// Premise: the stored row is STILL stripped. If this fails, the row was
	// repaired by hand and this bot is no longer exercising the fallback path.
	assert('premise: feast raw config is still stripped (no lifeline seed)',
		hasLifelineSeed(feast.powerup_config), false);

	const feastResolved = resolveStrengths(feast.powerup_config);
	console.log(`  resolved: ${JSON.stringify(feastResolved)}`);
	assertStrengths('feast', feastResolved);

	// ── contrast: a healthy set that still carries the seeds ───────────────────
	const healthy = sets.find((s) => s.id !== feast.id && hasLifelineSeed(s.powerup_config));
	if (!healthy) throw new Error('No contrast set with intact seeds found');

	console.log(`\nContrast set: ${healthy.name} (${healthy.id})`);
	console.log(`  raw powerup_config: ${JSON.stringify(healthy.powerup_config)}`);

	assert('premise: contrast raw config still has its seeds',
		hasLifelineSeed(healthy.powerup_config), true);

	const healthyResolved = resolveStrengths(healthy.powerup_config);
	console.log(`  resolved: ${JSON.stringify(healthyResolved)}`);
	assertStrengths('contrast', healthyResolved);

	// The point of the fix: stripped and healthy resolve IDENTICALLY.
	assert('feast resolves identically to a healthy seeded set', feastResolved, healthyResolved);

	// ── report ─────────────────────────────────────────────────────────────────
	console.log('');
	let failures = 0;
	for (const c of checks) {
		if (!c.pass) failures++;
		console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  ${c.detail}`);
	}
	console.log(
		`\n${failures === 0 ? 'GREEN' : 'RED'}: ${checks.length - failures}/${checks.length} checks passed`
	);
	if (failures > 0) process.exit(1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
