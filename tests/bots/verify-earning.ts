// End-to-end powerup-EARNING verification harness (piece 3a).
//
//   npm run bots:verify-earning
//
// The pure planner already has an 18/18 unit sweep (planAwards). This is the
// END-TO-END layer: for each config scenario it drives a real ace bot through
// real submissions → real awardPowerups → real DB rows, then asserts the row
// counts and the cumulative highwater against what the model predicts.
//
// Per scenario:
//   1. soft-reset the Mechanics Test set (mirrors src/lib/server/reset.ts,
//      scoped to this set — clears submissions/attempts/team_powerups/
//      team_effects, zeroes teams score + last_threshold_crossed, detaches
//      players, play_state → joining). NOT imported from $lib: the bot harness
//      deliberately avoids $lib alias resolution (see challenge.ts), so the
//      reset is reproduced here with the service-role client.
//   2. write game_sets.powerup_config = the scenario's v2 config (direct UPDATE).
//   3. one ace bot (accuracy 1.0 → deterministic ~100% every challenge) joins.
//   4. flip play_state → playing (the "host starts the game" step).
//   5. the bot plays every challenge (reuses playChallenge / the fixture).
//   6. query team_powerups (count, by type) + teams.last_threshold_crossed and
//      compare against the scenario's expected values. Print a pass/fail row.
//
// Determinism: only the chance=0 / chance=1 edges are asserted on COUNT — mid-
// probability counts are statistical and need many runs (a future check, not
// built here). WHICH type drops per band is random; only the COUNT is asserted.
//
// ── power_spin, and why `total` counts DIRECT awards only ───────────────────
//
// One earned powerup does not always mean one team_powerups row. power_spin is
// immediate_use (migration 0072:119 — "the spin fires on earn; there is nothing
// to hold"), so materializeAward() auto-activates it the moment it is earned
// (powerups.ts:715-718), and the spin's branch hands its rolled prize straight
// back to materializeAward (powerups.ts:2106) — a SECOND row. Earning a
// power_spin therefore writes two rows; earning anything else writes one.
//
// That is correct, intended behaviour, not a bug: the spin is a powerup whose
// entire effect is to award another powerup, and it deliberately reuses the
// ladder's own award path so a spun powerup behaves exactly like an earned one.
//
// It made this harness flaky, because BOTH halves are random and the oracle
// could see neither:
//   * how OFTEN power_spin is picked — planAwards:653-658 picks one type at
//     random per fired band, from a pool of ~18, using Math.random (:802). Over
//     18 bands it lands roughly once, but with real spread.
//   * WHICH prize the wheel rolls — pickSpinType (powerups.ts:2082). This one
//     only changes the type, never the count: every spin yields exactly one
//     prize.
// So a raw row count was "18 + however many spins happened to fall", which is
// exactly the 18/19/20/22 wobble that was observed.
//
// The fix keeps the hand-reasoned expectations untouched (18 / 6 / 3 / 0 / 18 —
// they were always right about the LADDER) and makes the measurement mean what
// they say: `total` counts rows the ladder handed out, with spin prizes
// subtracted via spinPrizeIds(). power_spin does not lose coverage — it gains
// some: every scenario now asserts the invariant "one earned spin materialized
// exactly one prize, and no prize was itself a spin" (non-recursion, closed off
// by SPIN_EXCLUDED_TYPE_IDS in powerups-meta.ts:285). The spin/prize counts are
// reported per scenario but never compared to a constant — pinning them would
// mean pinning the RNG, which would test the harness's seed rather than the
// game.
//
// Requires: app running (BOT_BASE_URL, default http://localhost:5173) on the
// feature/powerup-runtime-v2 branch (the earning runtime under test), the
// Mechanics Test set seeded (npm run seed:mechanics), and its fixture at
// tests/bots/fixtures/<setId>.json (npm run bots:fixtures).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { chromium, type Page } from '@playwright/test';
import { Player } from './player';
import { playChallenge } from './challenge';
import { PRESETS } from './personality';
import { loadFixtures, fixtureMap } from './fixtures';
import { BOT_BASE_URL } from './config';

// ── .env loader (only sets keys not already in the environment) ───────────────
function loadEnv() {
	try {
		const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
		for (const line of raw.split('\n')) {
			const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
			if (!m) continue;
			let val = m[2].trim();
			if (
				(val.startsWith('"') && val.endsWith('"')) ||
				(val.startsWith("'") && val.endsWith("'"))
			) {
				val = val.slice(1, -1);
			}
			if (!(m[1] in process.env)) process.env[m[1]] = val;
		}
	} catch {
		/* no .env — rely on the real environment */
	}
}

const SET_ID = 'e5100000-0000-4000-8000-000000000001';

// The type POOL is derived from powerup_types at run start (deriveWorkingTypes),
// NOT hardcoded — a hardcoded list silently drifts as the catalog grows and lets
// un-neutralised types leak awards into the chance=0 scenario. The three filters
// below are the planner's TYPE-TRAIT predicates (powerups.ts:165-168): coming_soon,
// enabled_by_default, default_inverse. The planner narrows further at runtime by
// category (:167) and per-type threshold band (:169-170), but those only ever
// SUBTRACT from the pool — so zeroing `chance` across this trait-eligible superset
// is the correct, safe basis for emptying the pool.
//
// SELF_TYPES stays hardcoded ON PURPOSE: it is part of the ORACLE (the manually
// reasoned expectation of which awards belong to the `self` category), not the
// pool. Deriving it from the same catalog the behaviour reads would make the test
// grade itself. Do not "robustify" it into a query.
const SELF_TYPES = ['bonus_points', 'hard_gaan', 'single_event_mult'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PowerupTypeOverride = { enabled?: boolean; threshold?: number; chance?: number; inverse?: boolean };
type V2Config = {
	version: 2;
	threshold_mode: 'per_challenge' | 'cumulative';
	band_mode: 'all_bands' | 'highest_band';
	thresholds_percent: number[];
	types: Record<string, PowerupTypeOverride>;
	categories: Record<string, boolean>;
};

/**
 * Derive the awardable type pool from the live catalog, using the planner's
 * type-trait predicates (powerups.ts:165-168): non-coming_soon, enabled by
 * default, non-inverse. Sorted for stable, comparable logging. This is the set
 * the harness must give a chance override to, so `allChance(0)` truly empties
 * the pool regardless of how many types the catalog grows to.
 */
async function deriveWorkingTypes(db: SupabaseClient): Promise<string[]> {
	const { data, error } = await db
		.from('powerup_types')
		.select('id, enabled_by_default, coming_soon, default_inverse');
	if (error) throw new Error(`deriveWorkingTypes: ${error.message}`);
	return ((data ?? []) as { id: string; enabled_by_default: boolean; coming_soon: boolean; default_inverse: boolean }[])
		.filter((t) => t.enabled_by_default && !t.coming_soon && !t.default_inverse)
		.map((t) => t.id)
		.sort();
}

/** Build a `types` map giving every working type the same chance (enabled). */
function allChance(v: number, workingTypes: string[]): Record<string, PowerupTypeOverride> {
	const types: Record<string, PowerupTypeOverride> = {};
	for (const id of workingTypes) types[id] = { enabled: true, chance: v };
	return types;
}

function cfg(over: Partial<V2Config>): V2Config {
	return {
		version: 2,
		threshold_mode: 'per_challenge',
		band_mode: 'all_bands',
		thresholds_percent: [25, 50, 75],
		types: {},
		categories: {},
		...over
	};
}

type Expected = {
	total?: number;
	highwater?: number;
	selfCount?: number;
	/** power_spin rows the LADDER handed out this run. Random — never asserted. */
	spins?: number;
	/** Rows materialized BY those spins. Asserted only against `spins`, 1:1. */
	prizes?: number;
};
type Scenario = { key: string; note: string; config: V2Config; expect: Expected };

/**
 * The team_powerups ids that were materialized BY a power_spin roll, rather than
 * earned directly off the ladder.
 *
 * There is no way to tell them apart from the row itself — powerups.ts:2067 says
 * so outright ("what makes a spun powerup indistinguishable from an earned one"):
 * the spin's prize goes through the SAME materializeAward() the ladder uses
 * (powerups.ts:2106 vs :825), so it carries the same team_id, set_id, status and
 * even the same granted_from_challenge_id. The discriminator is the audit trail
 * the spin writes alongside it: an activity_log 'power_spin' event whose payload
 * names the row it created (powerups.ts:2123-2132).
 *
 * Matched BY ID on purpose. activity_log is the one table softReset() does not
 * clear, so this query also returns ids from every previous run — but those name
 * team_powerups rows that were deleted, so they cannot collide with this run's
 * fresh uuids. Id-matching makes the subtraction run-independent for free; a
 * count of log rows would not have been.
 */
async function spinPrizeIds(db: SupabaseClient, teamId: string): Promise<Set<string>> {
	const { data } = await db
		.from('activity_log')
		.select('payload')
		.eq('event_type', 'power_spin')
		.eq('team_id', teamId);
	const ids = new Set<string>();
	for (const row of (data ?? []) as { payload: { awarded_team_powerup_id?: string } | null }[]) {
		const id = row.payload?.awarded_team_powerup_id;
		if (id) ids.add(id);
	}
	return ids;
}

/**
 * Build the scenario matrix. Only the POOL (which types get a chance override)
 * is derived from `workingTypes`; the `expect` values stay hand-reasoned — one
 * award lands per crossed band regardless of pool size, so growing the catalog
 * does not change any expected count. Never compute an expected value from the
 * catalog or planner: that would make the harness grade itself.
 */
function buildScenarios(workingTypes: string[]): Scenario[] {
	return [
		{
			key: 'per_challenge · all_bands · chance=1',
			note: '3 awards/challenge × 6 challenges',
			config: cfg({ threshold_mode: 'per_challenge', band_mode: 'all_bands', types: allChance(1, workingTypes) }),
			expect: { total: 18, highwater: 0 }
		},
		{
			key: 'per_challenge · highest_band · chance=1',
			note: '1 award/challenge × 6 challenges',
			config: cfg({ threshold_mode: 'per_challenge', band_mode: 'highest_band', types: allChance(1, workingTypes) }),
			expect: { total: 6, highwater: 0 }
		},
		{
			key: 'cumulative · all_bands · chance=1',
			note: '3 bands crossed once over the game; highwater → 75',
			config: cfg({ threshold_mode: 'cumulative', band_mode: 'all_bands', types: allChance(1, workingTypes) }),
			expect: { total: 3, highwater: 75 }
		},
		{
			key: 'cumulative · all_bands · chance=0',
			note: '0 awards, but highwater STILL advances → 75',
			config: cfg({ threshold_mode: 'cumulative', band_mode: 'all_bands', types: allChance(0, workingTypes) }),
			expect: { total: 0, highwater: 75 }
		},
		{
			key: 'category-off(self) · per_challenge · all_bands · chance=1',
			note: 'self types never drop; other categories still fire (18 total)',
			config: cfg({
				threshold_mode: 'per_challenge',
				band_mode: 'all_bands',
				types: allChance(1, workingTypes),
				categories: { self: false }
			}),
			expect: { total: 18, selfCount: 0 }
		}
	];
}

/** Soft-reset scoped to the Mechanics set — mirrors reset.ts's operations. */
async function softReset(db: SupabaseClient) {
	const { data: scRows } = await db
		.from('set_challenges')
		.select('challenge_id')
		.eq('set_id', SET_ID);
	const challengeIds = [...new Set((scRows ?? []).map((s) => s.challenge_id as string))];

	await db.from('team_powerups').delete().eq('set_id', SET_ID);
	await db.from('team_effects').delete().eq('set_id', SET_ID);
	if (challengeIds.length) {
		await db.from('submissions').delete().in('challenge_id', challengeIds);
		await db.from('challenge_attempts').delete().in('challenge_id', challengeIds);
		await db.from('challenge_hints_used').delete().in('challenge_id', challengeIds);
	}
	await db.from('challenge_unlocks').delete().eq('set_id', SET_ID);
	await db
		.from('teams')
		.update({ score: 0, current_streak: 0, held_powerups: [], last_threshold_crossed: 0 })
		.not('id', 'is', null); // all teams (Supabase requires a filter on update)
	await db.from('players').update({ set_id: null, team_id: null }).eq('set_id', SET_ID);
	await db
		.from('game_sets')
		.update({
			play_state: 'joining',
			started_at: null,
			ended_at: null,
			crown_holder_team_id: null,
			crown_payout_applied: false
		})
		.eq('id', SET_ID);
}

/** Read the ordered playable-challenge list from a /team page (from run-play.ts). */
async function readChallengeList(page: Page): Promise<string[]> {
	return page
		.locator('a[href^="/challenge/"]')
		.evaluateAll((links: Element[]) =>
			links.map((a) => (a.getAttribute('href') ?? '').split('/').pop() ?? '')
		);
}

async function runScenario(
	db: SupabaseClient,
	browser: Awaited<ReturnType<typeof chromium.launch>>,
	scenario: Scenario
): Promise<{ actual: Expected; pass: boolean; note?: string; spinNote?: string }> {
	// 1-2. reset + write the scenario config
	await softReset(db);
	await db
		.from('game_sets')
		.update({ powerups_enabled: true, powerup_config: scenario.config })
		.eq('id', SET_ID);

	// 3. one ace bot joins
	const bot = new Player('EarnBot', browser);
	try {
		const join = await bot.join(SET_ID);
		if (join.status !== 'joined') return { actual: {}, pass: false, note: `join ${join.status}` };
		const teamColor = bot.team!;

		// 4. host starts the game
		await db.from('game_sets').update({ play_state: 'playing' }).eq('id', SET_ID);

		// 5. play every listed challenge
		const page = bot.page!;
		const fx = fixtureMap(loadFixtures(`tests/bots/fixtures/${SET_ID}.json`));
		let list: string[] = [];
		for (let attempt = 0; attempt < 10 && list.length === 0; attempt++) {
			await page.goto(`${BOT_BASE_URL}/team`);
			list = await readChallengeList(page);
			if (list.length === 0) await sleep(1500);
		}
		for (const id of list) {
			const entry = fx.get(id);
			await playChallenge(
				page,
				{
					id,
					variant: entry?.variant ?? 'standard',
					fields: entry?.fields ?? {},
					accepted_titles: entry?.accepted_titles
				},
				PRESETS.ace,
				teamColor
			);
		}

		// 6. assert
		const { data: team } = await db
			.from('teams')
			.select('id, last_threshold_crossed, score')
			.eq('color', teamColor)
			.maybeSingle();
		const { data: tpu } = await db
			.from('team_powerups')
			.select('id, powerup_type_id')
			.eq('set_id', SET_ID)
			.eq('team_id', team!.id);
		const rows = (tpu ?? []) as { id: string; powerup_type_id: string }[];

		// Split the rows into DIRECTLY EARNED and SPIN PRIZES before counting —
		// see the header. `total` counts what the ladder handed out, which is what
		// every hand-reasoned expectation in buildScenarios() is about.
		const prizeIds = await spinPrizeIds(db, team!.id as string);
		const direct = rows.filter((r) => !prizeIds.has(r.id));
		const prizes = rows.filter((r) => prizeIds.has(r.id));
		const spins = direct.filter((r) => r.powerup_type_id === 'power_spin');

		const actual: Expected = {
			total: direct.length,
			highwater: (team?.last_threshold_crossed as number) ?? 0,
			// Over the DIRECT awards: the claim is that the ladder never drops a self
			// type, and the ladder is the only thing the category switch governs here.
			selfCount: direct.filter((r) => SELF_TYPES.includes(r.powerup_type_id)).length,
			spins: spins.length,
			prizes: prizes.length
		};

		const pass = (Object.keys(scenario.expect) as (keyof Expected)[]).every(
			(k) => actual[k] === scenario.expect[k]
		);

		// The power_spin invariant, asserted on every scenario regardless of what it
		// expects: each earned spin materialized exactly one prize, and no prize was
		// itself a spin. Both numbers are random per run; their RELATION is not.
		const spinPass = actual.prizes === actual.spins && !prizes.some((r) => r.powerup_type_id === 'power_spin');
		const spinNote = `spins=${actual.spins} → prizes=${actual.prizes}`;

		return {
			actual,
			pass: pass && spinPass,
			note: spinPass ? undefined : `power_spin invariant broken: ${spinNote}`,
			spinNote
		};
	} finally {
		await bot.close();
	}
}

async function main() {
	loadEnv();
	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error('Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
	const db = createClient(url, key, { auth: { persistSession: false } });

	// Derive the awardable type pool from the live catalog and log it, so
	// catalog drift shows up in the output instead of silently leaking awards.
	const workingTypes = await deriveWorkingTypes(db);
	const SCENARIOS = buildScenarios(workingTypes);

	console.log(`▶ Powerup earning verification — ${SCENARIOS.length} scenarios against ${BOT_BASE_URL}`);
	console.log(`  set: ${SET_ID}  profile: ace (accuracy 1.0)`);
	console.log(`  pool: ${workingTypes.length} awardable types (enabled_by_default, !coming_soon, !inverse)`);
	console.log(`        ${workingTypes.join(', ')}\n`);

	const browser = await chromium.launch();
	const results: Array<{
		scenario: Scenario;
		actual: Expected;
		pass: boolean;
		note?: string;
		spinNote?: string;
	}> = [];
	try {
		for (const scenario of SCENARIOS) {
			process.stdout.write(`  running: ${scenario.key} … `);
			const r = await runScenario(db, browser, scenario);
			console.log(r.pass ? 'PASS' : `FAIL${r.note ? ` (${r.note})` : ''}`);
			results.push({ scenario, ...r });
		}
	} finally {
		await browser.close();
		// Leave the set in a known-good state so a later manual/live test doesn't
		// inherit the LAST scenario's config (e.g. the categories:{self:false} that
		// once confused live testing). Clean reset + a plain default v2 config.
		await softReset(db);
		await db
			.from('game_sets')
			.update({
				powerups_enabled: true,
				powerup_config: cfg({}) // per_challenge / all_bands / [25,50,75], no type/category overrides
			})
			.eq('id', SET_ID);
		console.log('↩ restored powerup_config to default + reset the set\n');
	}

	// ── Report table ──────────────────────────────────────────────────────────
	console.log('\n─── Results ───');
	const fmt = (e: Expected) =>
		[
			e.total !== undefined ? `total=${e.total}` : null,
			e.highwater !== undefined ? `hw=${e.highwater}` : null,
			e.selfCount !== undefined ? `self=${e.selfCount}` : null
		]
			.filter(Boolean)
			.join(' ');
	for (const { scenario, actual, pass, spinNote } of results) {
		console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'}  ${scenario.key}`);
		console.log(`    ${scenario.note}`);
		console.log(`    expected: ${fmt(scenario.expect)}`);
		console.log(`    actual:   ${fmt({ ...scenario.expect, ...pickActual(scenario.expect, actual) })}`);
		// Printed OUTSIDE the expected/actual pair on purpose: these two numbers are
		// random per run and are never compared against a constant. Only their 1:1
		// relation is asserted, and that is folded into the PASS above.
		if (spinNote) console.log(`    audit:    ${spinNote} (1:1 invariant, counts vary by design)`);
	}

	const passed = results.filter((r) => r.pass).length;
	console.log(`\n${passed}/${results.length} scenarios passed`);
	if (passed !== results.length) process.exit(1);
}

/** Restrict the actual readout to the keys the scenario asserts on. */
function pickActual(expect: Expected, actual: Expected): Expected {
	const out: Expected = {};
	for (const k of Object.keys(expect) as (keyof Expected)[]) out[k] = actual[k];
	return out;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
