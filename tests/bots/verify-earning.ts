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
const WORKING_TYPES = [
	'shield',
	'time_boost',
	'insurance',
	'bonus_points',
	'hard_gaan',
	'single_event_mult',
	'free_answer'
];
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

/** Build a `types` map giving every working type the same chance (enabled). */
function allChance(v: number): Record<string, PowerupTypeOverride> {
	const types: Record<string, PowerupTypeOverride> = {};
	for (const id of WORKING_TYPES) types[id] = { enabled: true, chance: v };
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

type Expected = { total?: number; highwater?: number; selfCount?: number };
type Scenario = { key: string; note: string; config: V2Config; expect: Expected };

const SCENARIOS: Scenario[] = [
	{
		key: 'per_challenge · all_bands · chance=1',
		note: '3 awards/challenge × 6 challenges',
		config: cfg({ threshold_mode: 'per_challenge', band_mode: 'all_bands', types: allChance(1) }),
		expect: { total: 18, highwater: 0 }
	},
	{
		key: 'per_challenge · highest_band · chance=1',
		note: '1 award/challenge × 6 challenges',
		config: cfg({ threshold_mode: 'per_challenge', band_mode: 'highest_band', types: allChance(1) }),
		expect: { total: 6, highwater: 0 }
	},
	{
		key: 'cumulative · all_bands · chance=1',
		note: '3 bands crossed once over the game; highwater → 75',
		config: cfg({ threshold_mode: 'cumulative', band_mode: 'all_bands', types: allChance(1) }),
		expect: { total: 3, highwater: 75 }
	},
	{
		key: 'cumulative · all_bands · chance=0',
		note: '0 awards, but highwater STILL advances → 75',
		config: cfg({ threshold_mode: 'cumulative', band_mode: 'all_bands', types: allChance(0) }),
		expect: { total: 0, highwater: 75 }
	},
	{
		key: 'category-off(self) · per_challenge · all_bands · chance=1',
		note: 'self types never drop; other categories still fire (18 total)',
		config: cfg({
			threshold_mode: 'per_challenge',
			band_mode: 'all_bands',
			types: allChance(1),
			categories: { self: false }
		}),
		expect: { total: 18, selfCount: 0 }
	}
];

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
): Promise<{ actual: Expected; pass: boolean; note?: string }> {
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
			.select('powerup_type_id')
			.eq('set_id', SET_ID)
			.eq('team_id', team!.id);
		const rows = (tpu ?? []) as { powerup_type_id: string }[];

		const actual: Expected = {
			total: rows.length,
			highwater: (team?.last_threshold_crossed as number) ?? 0,
			selfCount: rows.filter((r) => SELF_TYPES.includes(r.powerup_type_id)).length
		};

		const pass = (Object.keys(scenario.expect) as (keyof Expected)[]).every(
			(k) => actual[k] === scenario.expect[k]
		);
		return { actual, pass };
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

	console.log(`▶ Powerup earning verification — ${SCENARIOS.length} scenarios against ${BOT_BASE_URL}`);
	console.log(`  set: ${SET_ID}  profile: ace (accuracy 1.0)\n`);

	const browser = await chromium.launch();
	const results: Array<{ scenario: Scenario; actual: Expected; pass: boolean; note?: string }> = [];
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
	for (const { scenario, actual, pass } of results) {
		console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'}  ${scenario.key}`);
		console.log(`    ${scenario.note}`);
		console.log(`    expected: ${fmt(scenario.expect)}`);
		console.log(`    actual:   ${fmt({ ...scenario.expect, ...pickActual(scenario.expect, actual) })}`);
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
