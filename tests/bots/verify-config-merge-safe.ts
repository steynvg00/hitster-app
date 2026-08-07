// powerup_config write-safety + the lifeline earn-chance fallback.
//
//   npm run bots:verify-config-merge-safe
//
// Pure/static harness — no database, no browser. Everything asserted here is a
// property of the config WRITE BOUNDARY and of the pure earning planner, so it
// runs in milliseconds and reproduces exactly.
//
// ── Bug 1: the wholesale overwrite ──────────────────────────────────────────
//
// game_sets.powerup_config is ONE jsonb column carrying three families of keys:
//
//   v2 earning keys     threshold_mode, band_mode, thresholds_percent,
//                       types{}, categories{}, computed_set_max
//   per-type overrides  types.<id>.{enabled,threshold,chance,dice_min,…} —
//                       including the values migrations 0070/0071/0072 seeded
//   token-shop keys     starting_tokens, per_correct_challenge, streak_bonuses,
//                       time_tick_minutes, tokens_per_tick
//
// parseConfig() models only the FIRST TWO families. It builds a fresh object
// literal (src/lib/server/powerups.ts:108-116), so every token-shop key is
// dropped on the way through. That gives two distinct ways to lose data at a
// write:
//
//   WHOLESALE   set_powerup_mode / save_powerup_config replaced the entire
//               column with a freshly-built default. Every override and every
//               migration seed gone, on a single click — including a click on
//               the mode that was ALREADY active.
//   LOSSY       saveThresholds / saveTypeConfig / toggleCategory / the
//               computed_set_max cache write went parse → merge → write, which
//               keeps the v2 keys but silently drops the token-shop family.
//               Reachable today: the powerup grid renders in BOTH modes, so a
//               per-type toggle while in token_shop mode wiped the token config.
//
// The fix is one rule — never write a config that was not merged onto the
// STORED object — expressed as three helpers (mergeConfigPatch /
// mergeConfigKeys / fillConfigDefaults). Part 1 pins the helpers' behaviour;
// part 2 pins the rule itself against the source, so a future action that
// writes powerup_config without merging fails here rather than in a live game.
//
// ── Bug 2: lifeline's earn chance on a fresh set ────────────────────────────
//
// Lifeline is designed to drop on ~50% of qualifying (low-score) submissions.
// That 0.5 existed ONLY as a per-set jsonb seed written by migration 0071 into
// the rows that existed when it ran. planAwards resolves chance generically
// (`?? 1`), so a set created AFTER that migration earned lifeline at 1.0 —
// twice the designed rate, and no code path could ever notice.
//
// Contrast lucky_dice and power_spin: both carry a code constant + resolver
// (LUCKY_DICE_DEFAULT_MIN/MAX, POWER_SPIN_DEFAULT_TIER_S_CHANCE), so their
// identical seeds are belt-and-braces. Lifeline's seed was load-bearing.
// Part 3 pins the fallback, and pins that a per-set override still wins.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	parseConfig,
	mergePowerupConfig,
	mergeConfigPatch,
	mergeConfigKeys,
	fillConfigDefaults,
	resolveTypeChance,
	resolveDiceRange,
	resolveSpinTierSChance,
	resolveResurrectionScoreMode,
	resolveEyeShowScores,
	planAwards,
	LIFELINE_DEFAULT_CHANCE,
	type PowerupType
} from '../../src/lib/server/powerups';
import { setPresets } from '../../src/lib/presets/setPresets';

// ── tiny assert harness (same shape as verify-power-spin.ts) ─────────────────
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	const detail = pass
		? JSON.stringify(got)
		: `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`;
	checks.push({ name, pass, detail });
	console.log(`  ${pass ? '✓' : '✗'} ${name}  ${detail}`);
}
function assertTrue(name: string, cond: boolean, detail: string) {
	checks.push({ name, pass: cond, detail });
	console.log(`  ${cond ? '✓' : '✗'} ${name}  ${detail}`);
}

// Comments are stripped before any source is inspected. Part 2 asks what the
// CODE does, and the comments in these files quote the very patterns it hunts
// for ("this used to write `powerup_config: defaults[mode]`") — reading prose
// would let a paragraph fail the build, or worse, let one vouch for a write
// that never happens.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const read = (p: string) => stripComments(readFileSync(resolve(process.cwd(), p), 'utf8'));
const SET_PAGE = 'src/routes/admin/sets/[id]/+page.server.ts';
const POWERUPS = 'src/lib/server/powerups.ts';

// ── the fixture: a set that has been configured by a host ───────────────────
// Deliberately carries all three key families at once, because the whole point
// is that a write touching one family must not disturb the other two.
function liveStoredConfig(): Record<string, unknown> {
	return {
		version: 2,
		threshold_mode: 'cumulative',
		band_mode: 'highest_band',
		thresholds_percent: [40, 70],
		computed_set_max: 1234,
		types: {
			// host-tuned
			shield: { enabled: false, threshold: 55, chance: 0.25 },
			// migration seeds (0070 / 0071 / 0072)
			lucky_dice: { dice_min: 2, dice_max: 12 },
			lifeline: { chance: 0.5 },
			power_spin: { tier_s_chance: 0.15 },
			all_seeing_eye: { show_scores: true },
			resurrection: { score_mode: 'best' }
		},
		categories: { offensive: false, social: true },
		// token-shop family — invisible to parseConfig
		starting_tokens: 7,
		per_correct_challenge: 3,
		streak_bonuses: [{ streak: 4, bonus: 9 }],
		time_tick_minutes: 12,
		tokens_per_tick: 2
	};
}

const TOKEN_KEYS = [
	'starting_tokens',
	'per_correct_challenge',
	'streak_bonuses',
	'time_tick_minutes',
	'tokens_per_tick'
] as const;

const survives = (cfg: Record<string, unknown>) => ({
	shieldOverride: (cfg.types as Record<string, unknown> | undefined)?.['shield'],
	diceSeed: (cfg.types as Record<string, unknown> | undefined)?.['lucky_dice'],
	lifelineSeed: (cfg.types as Record<string, unknown> | undefined)?.['lifeline'],
	spinSeed: (cfg.types as Record<string, unknown> | undefined)?.['power_spin'],
	categories: cfg.categories,
	tokenKeys: Object.fromEntries(TOKEN_KEYS.filter((k) => k in cfg).map((k) => [k, cfg[k]]))
});

// ── PART 1 — the helpers preserve what they do not touch ────────────────────
function part1() {
	console.log('\nPART 1 — merge helpers preserve every sibling key');

	const stored = liveStoredConfig();

	// The witness: what the OLD code did. Kept as an executable assertion rather
	// than a comment so the reason these helpers exist cannot quietly stop being
	// true. Both are still real behaviours of the primitives — they are simply
	// no longer what a WRITE does.
	const oldWholesale = { thresholds_percent: [25, 50, 75] } as Record<string, unknown>;
	assert('witness: a wholesale write kept no per-type override', oldWholesale.types ?? null, null);
	const oldRoundTrip = mergePowerupConfig(parseConfig(stored), {
		categories: { social: false }
	}) as unknown as Record<string, unknown>;
	assert(
		'witness: a parse→merge round-trip dropped every token-shop key',
		TOKEN_KEYS.filter((k) => k in oldRoundTrip),
		[]
	);

	// mergeConfigPatch — the v2-aware write (saveThresholds / saveTypeConfig /
	// toggleCategory / the computed_set_max cache).
	const afterTypePatch = mergeConfigPatch(stored, {
		types: { x_ray: { reveal_budget: 3 } }
	});
	const s1 = survives(afterTypePatch);
	assert('patch: host override survives', s1.shieldOverride, {
		enabled: false,
		threshold: 55,
		chance: 0.25
	});
	assert('patch: dice seed survives', s1.diceSeed, { dice_min: 2, dice_max: 12 });
	assert('patch: lifeline seed survives', s1.lifelineSeed, { chance: 0.5 });
	assert('patch: spin seed survives', s1.spinSeed, { tier_s_chance: 0.15 });
	assert('patch: categories survive', s1.categories, { offensive: false, social: true });
	assert('patch: all 5 token-shop keys survive', Object.keys(s1.tokenKeys).length, 5);
	assert(
		'patch: the patched value landed',
		(afterTypePatch.types as Record<string, unknown>).x_ray,
		{
			reveal_budget: 3
		}
	);
	assert('patch: computed_set_max survives', afterTypePatch.computed_set_max, 1234);
	assert('patch: threshold_mode survives', afterTypePatch.threshold_mode, 'cumulative');

	// mergeConfigKeys — the token-shop write (save_powerup_config).
	const afterTokenSave = mergeConfigKeys(stored, {
		starting_tokens: 99,
		per_correct_challenge: 1,
		streak_bonuses: [],
		time_tick_minutes: null,
		tokens_per_tick: 5
	});
	const s2 = survives(afterTokenSave);
	assert('token save: host override survives', s2.shieldOverride, {
		enabled: false,
		threshold: 55,
		chance: 0.25
	});
	assert('token save: lifeline seed survives', s2.lifelineSeed, { chance: 0.5 });
	assert('token save: categories survive', s2.categories, { offensive: false, social: true });
	assert('token save: thresholds_percent survives', afterTokenSave.thresholds_percent, [40, 70]);
	assert('token save: the new token value landed', afterTokenSave.starting_tokens, 99);

	// fillConfigDefaults — the mode switch (set_powerup_mode). Fills only what is
	// ABSENT; a stored value always wins.
	const modeDefaults = {
		starting_tokens: 0,
		per_correct_challenge: 1,
		streak_bonuses: [
			{ streak: 3, bonus: 2 },
			{ streak: 5, bonus: 5 }
		],
		time_tick_minutes: null,
		tokens_per_tick: 1
	};
	const afterModeClick = fillConfigDefaults(stored, modeDefaults);
	const s3 = survives(afterModeClick);
	assert('mode click: host override survives', s3.shieldOverride, {
		enabled: false,
		threshold: 55,
		chance: 0.25
	});
	assert('mode click: dice seed survives', s3.diceSeed, { dice_min: 2, dice_max: 12 });
	assert('mode click: lifeline seed survives', s3.lifelineSeed, { chance: 0.5 });
	assert('mode click: categories survive', s3.categories, { offensive: false, social: true });
	assert('mode click: stored token value NOT overwritten', afterModeClick.starting_tokens, 7);
	assert('mode click: thresholds_percent survives', afterModeClick.thresholds_percent, [40, 70]);

	// …and it still seeds a config that has never had the keys, which is what
	// keeps the token-shop form's unchecked `initShop().streak_bonuses.map()`
	// (+page.svelte:332) from dereferencing undefined on a fresh token set.
	const bare = fillConfigDefaults({ thresholds_percent: [25, 50, 75] }, modeDefaults);
	assert('mode click: missing token keys ARE seeded', Object.keys(bare).sort(), [
		'per_correct_challenge',
		'starting_tokens',
		'streak_bonuses',
		'thresholds_percent',
		'time_tick_minutes',
		'tokens_per_tick'
	]);

	// The scenario from the brief, end to end: set an override, click the mode,
	// save the config, and look for the override afterwards.
	let cfg: Record<string, unknown> = { thresholds_percent: [25, 50, 75] };
	// min_score_pct stands in for "some per-type override" here — this assertion is
	// about the MERGE surviving a mode click, not about what the key means. It used
	// to be `threshold`, the one key laag 1 removed for being a lower bound on a
	// normal type and an upper bound on an inverse one.
	cfg = mergeConfigPatch(cfg, {
		types: { freeze: { enabled: true, min_score_pct: 65, chance: 0.4 } }
	});
	cfg = fillConfigDefaults(cfg, modeDefaults); // ?/set_powerup_mode
	cfg = mergeConfigKeys(cfg, { starting_tokens: 4 }); // ?/save_powerup_config
	cfg = fillConfigDefaults(cfg, { thresholds_percent: [25, 50, 75] }); // mode clicked back
	assert(
		'THE LANDMINE: override survives mode-click + config-save',
		(cfg.types as Record<string, unknown>).freeze,
		{
			enabled: true,
			min_score_pct: 65,
			chance: 0.4
		}
	);
	assert('THE LANDMINE: the token key written in between also survives', cfg.starting_tokens, 4);

	// Degenerate inputs must not throw or invent a config.
	assertTrue(
		'null / array / scalar stored config are handled',
		JSON.stringify(mergeConfigPatch(null, {}).types) === '{}' &&
			JSON.stringify(mergeConfigPatch([1, 2], {}).types) === '{}' &&
			JSON.stringify(mergeConfigPatch('nope', {}).types) === '{}',
		'each normalises to an empty types map'
	);
}

// ── PART 2 — the rule, pinned against the source ────────────────────────────
// Behaviour tests prove the helpers are correct. They cannot prove the actions
// USE them. This part reads the two files that write the column and asserts
// that every write goes through a helper.
function part2() {
	console.log('\nPART 2 — no write of powerup_config bypasses a helper');

	const HELPERS = ['mergeConfigPatch(', 'mergeConfigKeys(', 'fillConfigDefaults('];
	const src = read(SET_PAGE);

	// Split the actions object into one block per action so a helper call in a
	// NEIGHBOURING action cannot vouch for this one.
	const blocks = src.split(/\n\t(?=[a-zA-Z_]+: async \()/);
	const writers = blocks.filter((b) => /\.update\([^)]*powerup_config:/s.test(b));
	const names = writers.map((b) => b.match(/^\s*([a-zA-Z_]+): async/)?.[1] ?? '(anonymous)');

	assert('every action that updates powerup_config is known', [...names].sort(), [
		'saveThresholds',
		'saveTypeConfig',
		'save_powerup_config',
		'set_powerup_mode',
		'toggleCategory'
	]);

	for (const [i, block] of writers.entries()) {
		assertTrue(
			`${names[i]} merges onto the stored config`,
			HELPERS.some((h) => block.includes(h)),
			HELPERS.some((h) => block.includes(h)) ? 'uses a merge helper' : 'WRITES WITHOUT MERGING'
		);
	}

	// The two shapes that caused the bug, named so they cannot come back.
	assertTrue(
		'no action writes a freshly-built default over the column',
		!/powerup_config:\s*defaults\[/.test(src) && !/powerup_config:\s*config as never/.test(src),
		'`defaults[mode]` and `config` wholesale writes are gone'
	);

	// The runtime cache write lives in the other file and had the same defect.
	const pu = read(POWERUPS);
	const cacheBlock = pu.slice(pu.indexOf('async function getOrComputeSetMax'));
	assertTrue(
		'getOrComputeSetMax merges its cache write onto the stored config',
		HELPERS.some((h) => cacheBlock.slice(0, cacheBlock.indexOf('\n}')).includes(h)),
		'the computed_set_max cache no longer drops token-shop keys'
	);
}

// ── PART 3 — lifeline earns at the designed rate on a fresh set ─────────────
function part3() {
	console.log('\nPART 3 — lifeline earn chance without a per-set seed');

	// A fresh set's config, taken from the two real creation paths rather than
	// invented: `create` inserts no powerup_config at all, so the column default
	// from migration 0033:18-20 applies; `createFromPreset` writes a preset
	// literal. Neither carries a types subtree.
	const dbColumnDefault = { thresholds_percent: [25, 50, 75] };
	const presetConfigs = setPresets
		.map((p) => p.defaults?.powerup_config)
		.filter((c): c is object => !!c);
	assertTrue(
		'no set preset seeds types.lifeline.chance',
		presetConfigs.every((c) => !('types' in (c as Record<string, unknown>))),
		`${presetConfigs.length} preset configs, none with a types subtree`
	);

	const fresh = parseConfig(dbColumnDefault);
	assert('fresh set has no per-type overrides at all', fresh.types, {});
	assert('resolved lifeline chance on a fresh set', resolveTypeChance(fresh, 'lifeline'), 0.5);
	assert('LIFELINE_DEFAULT_CHANCE is the designed 0.5', LIFELINE_DEFAULT_CHANCE, 0.5);
	assert('every other type still defaults to 1', resolveTypeChance(fresh, 'shield'), 1);
	assert('an unknown type still defaults to 1', resolveTypeChance(fresh, 'not_a_powerup'), 1);

	// The discriminating test. lifeline is inverse (migration 0071:85), so it is
	// planned by the inverse channel, which draws exactly ONE random number when
	// no ladder band fires. Pin that draw between the designed chance and the
	// generic fallback and the two are told apart:
	//
	//   rand = 0.6   chance 0.5 → no award      chance 1.0 → award  ← the bug
	//   rand = 0.4   chance 0.5 → award         chance 1.0 → award
	const lifeline = {
		id: 'lifeline',
		category: 'defensive',
		coming_soon: false,
		enabled_by_default: true,
		default_inverse: true,
		default_min_score_pct: 0,
		default_max_score_pct: 40
	} as unknown as PowerupType;

	// submissionPct 30 is below lifeline's 40% bound and below the only band, so
	// the ladder fires nothing and the single draw belongs to lifeline.
	const ctx = {
		submissionPct: 30,
		cumulativePct: 0,
		thresholdMode: 'per_challenge' as const,
		bandMode: 'all_bands' as const,
		lastThresholdCrossed: 0
	};
	const cfgFresh = parseConfig({ thresholds_percent: [50] });

	const at06 = planAwards(cfgFresh, [lifeline], ctx, () => 0.6).awards.map((a) => a.typeId);
	assert('fresh set, draw 0.6 → lifeline does NOT drop (chance is 0.5)', at06, []);

	const at04 = planAwards(cfgFresh, [lifeline], ctx, () => 0.4).awards.map((a) => a.typeId);
	assert('fresh set, draw 0.4 → lifeline drops', at04, ['lifeline']);

	// A per-set value must still win over the fallback in both directions —
	// otherwise this fix would have replaced one hardcoded number with another.
	const cfgTunedUp = parseConfig({ types: { lifeline: { chance: 1 } } });
	assert(
		'host override 1.0 beats the fallback (draw 0.6 → drops)',
		planAwards(cfgTunedUp, [lifeline], ctx, () => 0.6).awards.map((a) => a.typeId),
		['lifeline']
	);
	const cfgTunedDown = parseConfig({ types: { lifeline: { chance: 0 } } });
	assert(
		'host override 0 beats the fallback (draw 0.4 → nothing)',
		planAwards(cfgTunedDown, [lifeline], ctx, () => 0.4).awards.map((a) => a.typeId),
		[]
	);

	// And the seeded sets migration 0071 already touched are unchanged.
	const seeded = parseConfig({ types: { lifeline: { chance: 0.5 } } });
	assert('a 0071-seeded set resolves to the same 0.5', resolveTypeChance(seeded, 'lifeline'), 0.5);

	// ── the already-damaged set ────────────────────────────────────────────────
	// This is not a hypothetical config. A read-only SELECT over the live database
	// found "Vrienden Weekend 2026" holding exactly `{"thresholds_percent":[25,50,
	// 75]}` — byte for byte the literal set_powerup_mode used to write — while
	// every set created before AND after it still carries all five migration
	// seeds. The landmine fired on a real set and took its seeds with it.
	//
	// No migration repairs it, and none is needed: each of the five seeded values
	// is now backed by a code constant, so a stripped config resolves to exactly
	// what the seeds said. That is the whole argument for fixing this in code
	// rather than in SQL, so it is asserted rather than claimed.
	const stripped = parseConfig({ thresholds_percent: [25, 50, 75] });
	assert(
		'stripped set: lifeline chance resolves to the seeded 0.5',
		resolveTypeChance(stripped, 'lifeline'),
		0.5
	);
	assert('stripped set: dice range resolves to the seeded 1–6', resolveDiceRange(stripped), {
		min: 1,
		max: 6
	});
	assert(
		'stripped set: spin tier-S resolves to the seeded 0.15',
		resolveSpinTierSChance(stripped),
		0.15
	);
	assert(
		'stripped set: resurrection resolves to the seeded "replace"',
		resolveResurrectionScoreMode(stripped),
		'replace'
	);
	assert(
		'stripped set: eye show_scores resolves to the seeded false',
		resolveEyeShowScores(stripped),
		false
	);

	// The ladder channel reads chance through the same resolver, so a non-inverse
	// type is unaffected by the lifeline entry.
	const shield = {
		id: 'shield',
		category: 'defensive',
		coming_soon: false,
		enabled_by_default: true,
		default_inverse: false,
		default_min_score_pct: 60,
		default_max_score_pct: 100
	} as unknown as PowerupType;
	const ladderCtx = { ...ctx, submissionPct: 80 };
	assert(
		'ladder channel unchanged for a normal type (draw 0.6 → drops)',
		planAwards(
			parseConfig({ thresholds_percent: [50] }),
			[shield],
			ladderCtx,
			() => 0.6
		).awards.map((a) => a.typeId),
		['shield']
	);
}

function main() {
	console.log('powerup_config write-safety + lifeline earn-chance fallback');
	part1();
	part2();
	part3();

	const failed = checks.filter((c) => !c.pass);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	if (failed.length) {
		for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
		process.exit(1);
	}
}

main();
