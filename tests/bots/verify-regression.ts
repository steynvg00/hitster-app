// Regression + backstop-pipeline verification harness (piece 3b).
//
//   npm run bots:verify-regression
//
// Two phases, both producing a pass/fail table like verify-earning.ts. This is
// the DEEPER regression gate for the scoreAndPersistSubmission extraction
// (commit 2) and the auto-submit backstop pipeline (commit 3).
//
// PHASE A — interactive regression (safety anchor):
//   An ace bot (accuracy 1.0 → deterministic) plays the whole Mechanics Test set
//   through the normal submit action, then the harness asserts the resulting DB
//   state against an INDEPENDENT oracle computed from config (challenge
//   difficulty / set multiplier / variant field-points / speed threshold) via the
//   additive-delta breakdown formula — NOT by re-reading the app's own numbers.
//   Catches any change to scoring, the breakdown, streak progression, the score
//   aggregate, or crown transfer. Powerups are DISABLED here so no random earned
//   multiplier perturbs the deterministic totals (earning itself is covered by
//   verify-earning).
//
// PHASE B — backstop pipeline (best-effort automation):
//   A bot STARTS an attempt but never submits; the harness backdates the
//   attempt's started_at past deadline+grace (cleaner than a real 20s+ wait) and
//   POSTs /api/auto-submit (the same endpoint /admin/live polls — in DEV the
//   isAdmin guard is auto-satisfied by dev-auth, so a plain fetch works). It then
//   asserts the backstop ran the PIPELINE, not a hand-crafted 0:
//     B1 plain      → submission is_final, score 0; current_streak RESET to 0
//     B2 insurance  → the 0 is floored to 50% of max; the insurance effect is
//                     consumed (consumeEffects ran); current_streak RESET
//
// MANUAL-ONLY (inherently real-time — NOT automated here):
//   - Grace window edge: start a challenge, let it expire, and within ~20s the
//     backstop must NOT claim it; at ~25s past it must. (Sub-second timing can't
//     be faked without backdating, which defeats the point of testing the window.)
//   - time_boost: activate a time boost on a live challenge, let the ORIGINAL
//     deadline pass, and confirm /api/auto-submit does NOT close the attempt until
//     original+boost+grace elapses. (Requires a real running clock + a real
//     activation through the UI.)
//
// Requires: app running (BOT_BASE_URL) on feature/powerup-backstop-pipeline,
// the Mechanics Test set seeded, and its fixture. Reuses the bot infra
// (player.ts, challenge.ts, personality.ts, fixtures.ts).
//
// Config safety: restores the set's powerup_config to its pre-run state so
// manual console settings survive a harness run.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { chromium, type Page, type Browser } from '@playwright/test';
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
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
				val = val.slice(1, -1);
			}
			if (!(m[1] in process.env)) process.env[m[1]] = val;
		}
	} catch {
		/* rely on the real environment */
	}
}

const SET_ID = 'e5100000-0000-4000-8000-000000000001';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Default v2 config (powerups toggled per phase). Kept minimal — this harness
// asserts scoring/streak/crown/backstop, not earning config.
function defaultConfig() {
	return {
		version: 2,
		threshold_mode: 'per_challenge',
		band_mode: 'all_bands',
		thresholds_percent: [25, 50, 75],
		types: {},
		categories: {}
	};
}

/**
 * Snapshot the set's powerup_config BEFORE any phase mutates it, so the final
 * cleanup can restore it instead of overwriting it with a hardcoded default
 * (which used to silently wipe a host's manually-configured console settings
 * — e.g. a category toggle or an enabled type).
 */
async function stashConfig(db: SupabaseClient): Promise<ReturnType<typeof defaultConfig>> {
	const { data, error } = await db
		.from('game_sets')
		.select('powerup_config')
		.eq('id', SET_ID)
		.maybeSingle();
	if (error) {
		console.warn(
			`⚠ could not read pre-run powerup_config (${error.message}) — cleanup will fall back to the hardcoded default instead of restoring`
		);
		return defaultConfig();
	}
	return (data?.powerup_config as ReturnType<typeof defaultConfig> | null) ?? defaultConfig();
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
		.not('id', 'is', null);
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

async function readChallengeList(page: Page): Promise<string[]> {
	return page
		.locator('a[href^="/challenge/"]')
		.evaluateAll((links: Element[]) =>
			links.map((a) => (a.getAttribute('href') ?? '').split('/').pop() ?? '')
		);
}

/** Join one bot, then flip play_state → playing (the "host starts" step). */
async function joinAndStart(
	db: SupabaseClient,
	browser: Browser,
	config: { powerups: boolean }
): Promise<{ bot: Player; teamColor: string; teamId: string } | null> {
	await softReset(db);
	await db
		.from('game_sets')
		.update({ powerups_enabled: config.powerups, powerup_config: defaultConfig() })
		.eq('id', SET_ID);

	const bot = new Player('RegBot', browser);
	const join = await bot.join(SET_ID);
	if (join.status !== 'joined') {
		await bot.close();
		return null;
	}
	await db.from('game_sets').update({ play_state: 'playing' }).eq('id', SET_ID);
	const { data: team } = await db
		.from('teams')
		.select('id')
		.eq('color', bot.team!)
		.maybeSingle();
	return { bot, teamColor: bot.team!, teamId: team!.id as string };
}

// ─── Report plumbing ──────────────────────────────────────────────────────────
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({ name, pass, detail: pass ? `${JSON.stringify(got)}` : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}` });
}

// ─── Phase A: interactive regression ──────────────────────────────────────────
async function phaseA(db: SupabaseClient, browser: Browser) {
	const ctx = await joinAndStart(db, browser, { powerups: false });
	if (!ctx) {
		checks.push({ name: 'A: bot joined', pass: false, detail: 'join failed' });
		return;
	}
	const { bot, teamId } = ctx;
	const page = bot.page!;
	try {
		const fx = fixtureMap(loadFixtures(`tests/bots/fixtures/${SET_ID}.json`));
		let list: string[] = [];
		for (let i = 0; i < 10 && list.length === 0; i++) {
			await page.goto(`${BOT_BASE_URL}/team`);
			list = await readChallengeList(page);
			if (!list.length) await sleep(1500);
		}
		for (const id of list) {
			const e = fx.get(id);
			await playChallenge(
				page,
				{ id, variant: e?.variant ?? 'standard', fields: e?.fields ?? {}, accepted_titles: e?.accepted_titles },
				PRESETS.ace,
				bot.team!
			);
		}

		// ── Independent oracle from config ──────────────────────────────────────
		const challengeIds = list;
		const [{ data: chs }, { data: scs }, { data: vds }] = await Promise.all([
			db
				.from('challenges')
				.select('id, variant, difficulty_rating, speed_threshold_seconds')
				.in('id', challengeIds),
			db.from('set_challenges').select('challenge_id, challenge_multiplier').eq('set_id', SET_ID),
			db.from('variant_defaults').select('variant, points_config')
		]);
		const multBy = new Map((scs ?? []).map((s) => [s.challenge_id, Number(s.challenge_multiplier)]));
		const baseByVariant = new Map<string, number>();
		for (const vd of vds ?? []) {
			const fp = ((vd.points_config as Record<string, unknown> | null)?.field_points ?? {}) as Record<string, number>;
			baseByVariant.set(vd.variant, Object.values(fp).reduce((a, b) => a + b, 0));
		}
		const chById = new Map((chs ?? []).map((c) => [c.id, c]));

		// streak_config is null for these variants → streak_bonus is always 0.
		function expectedFor(id: string) {
			const c = chById.get(id)!;
			const base = baseByVariant.get(c.variant) ?? 0;
			const diff = Math.max(1, (c.difficulty_rating as number) / 3);
			const round = multBy.get(id) ?? 1;
			const comeback = 1;
			const speed = c.speed_threshold_seconds != null ? 5 : 0;
			const streak = 0;
			const multiplied = Math.round(base * (1 + (diff - 1) + (round - 1) + (comeback - 1)));
			return { base, diff, round, comeback, speed, streak, final: multiplied + streak + speed };
		}

		// ── Load actual submissions + assert per-challenge ──────────────────────
		const { data: subs } = await db
			.from('submissions')
			.select('challenge_id, score, status, answers')
			.in('challenge_id', challengeIds)
			.eq('team_id', teamId);
		const subByCh = new Map((subs ?? []).map((s) => [s.challenge_id, s]));

		let expectedTotal = 0;
		for (const id of challengeIds) {
			const exp = expectedFor(id);
			expectedTotal += exp.final;
			const sub = subByCh.get(id);
			const short = id.slice(-2);
			if (!sub) {
				checks.push({ name: `A ch${short}: submission exists`, pass: false, detail: 'missing' });
				continue;
			}
			const bd = ((sub.answers as Array<Record<string, unknown>>)?.[0]?.breakdown ?? {}) as Record<string, number>;
			assert(`A ch${short}: status auto_correct`, sub.status, 'auto_correct');
			assert(`A ch${short}: breakdown.base`, bd.base, exp.base);
			assert(`A ch${short}: difficulty_multiplier`, bd.difficulty_multiplier, exp.diff);
			assert(`A ch${short}: round_multiplier`, bd.round_multiplier, exp.round);
			assert(`A ch${short}: comeback_multiplier`, bd.comeback_multiplier, exp.comeback);
			assert(`A ch${short}: speed_bonus`, bd.speed_bonus, exp.speed);
			assert(`A ch${short}: streak_bonus`, bd.streak_bonus, exp.streak);
			assert(`A ch${short}: breakdown.final`, bd.final, exp.final);
			assert(`A ch${short}: submission.score`, sub.score, exp.final);
		}

		// ── Aggregate: score, streak, crown ─────────────────────────────────────
		const { data: team } = await db
			.from('teams')
			.select('score, current_streak')
			.eq('id', teamId)
			.maybeSingle();
		const { data: gs } = await db
			.from('game_sets')
			.select('crown_holder_team_id')
			.eq('id', SET_ID)
			.maybeSingle();
		// teams.score = Σ submission finals + 1 for the crown STEAL bonus that
		// maybeTransferCrown awards on the first crown take (the sole ace team takes
		// the crown on challenge 1, scoring > 0 with no prior holder). That +1 is
		// added directly to teams.score, not to any submission's final — so it's a
		// real part of the aggregate the oracle must include.
		assert('A aggregate: teams.score (Σfinals + crown steal +1)', team?.score, expectedTotal + 1);
		assert('A aggregate: current_streak == #challenges', team?.current_streak, challengeIds.length);
		assert('A aggregate: crown_holder == ace team', gs?.crown_holder_team_id, teamId);
	} finally {
		await bot.close();
	}
}

/** Start a challenge attempt (create the row) WITHOUT submitting. */
async function startAttemptOnly(page: Page, challengeId: string) {
	await page.goto(`${BOT_BASE_URL}/challenge/${challengeId}`);
	await page.waitForLoadState('domcontentloaded');
	const gate = page.locator('form[action="?/startChallenge"]');
	if (await gate.count()) {
		await gate.locator('button[type="submit"]').click();
		await page.locator('form[action="?/submit"]').waitFor({ timeout: 20_000 });
	}
	// deliberately no submit
}

// ─── Phase B: backstop pipeline ───────────────────────────────────────────────
async function backstopRun(
	db: SupabaseClient,
	browser: Browser,
	opts: { withInsurance: boolean; label: string }
) {
	const ctx = await joinAndStart(db, browser, { powerups: false });
	if (!ctx) {
		checks.push({ name: `B ${opts.label}: bot joined`, pass: false, detail: 'join failed' });
		return;
	}
	const { bot, teamId } = ctx;
	const page = bot.page!;
	const challengeId = 'e5100000-0000-4000-8000-000000000020'; // standard, base 20
	try {
		await startAttemptOnly(page, challengeId);

		// Pre-state: a nonzero streak (to prove the pipeline RESETS it) and,
		// optionally, an active insurance effect (to prove the floor + consumeEffects).
		await db.from('teams').update({ current_streak: 3 }).eq('id', teamId);
		let insuranceId: string | null = null;
		if (opts.withInsurance) {
			const { data: eff } = await db
				.from('team_effects')
				.insert({
					team_id: teamId,
					set_id: SET_ID,
					effect_type: 'insurance',
					payload: { floor_pct: 0.5 }
				})
				.select('id')
				.single();
			insuranceId = eff?.id ?? null;
		}

		// Backdate the attempt past deadline + grace (timer 90s, grace 20s) instead
		// of sleeping — the deadline math only reads started_at.
		const { data: attempt } = await db
			.from('challenge_attempts')
			.select('id')
			.eq('challenge_id', challengeId)
			.eq('team_id', teamId)
			.is('ended_at', null)
			.maybeSingle();
		if (!attempt) {
			checks.push({ name: `B ${opts.label}: attempt created`, pass: false, detail: 'no open attempt' });
			return;
		}
		const past = new Date(Date.now() - 200_000).toISOString(); // 200s ago > 90+20
		await db.from('challenge_attempts').update({ started_at: past }).eq('id', attempt.id);

		// Fire the backstop (same endpoint /admin/live polls; DEV auto-admin).
		const res = await fetch(`${BOT_BASE_URL}/api/auto-submit`, { method: 'POST' });
		checks.push({
			name: `B ${opts.label}: /api/auto-submit ok`,
			pass: res.ok,
			detail: `HTTP ${res.status}`
		});
		await sleep(500);

		// Assertions
		const { data: sub } = await db
			.from('submissions')
			.select('score, is_final')
			.eq('challenge_id', challengeId)
			.eq('team_id', teamId)
			.maybeSingle();
		const { data: team } = await db
			.from('teams')
			.select('current_streak')
			.eq('id', teamId)
			.maybeSingle();
		const { data: closedAttempt } = await db
			.from('challenge_attempts')
			.select('ended_at')
			.eq('id', attempt.id)
			.maybeSingle();

		assert(`B ${opts.label}: submission is_final`, sub?.is_final, true);
		assert(`B ${opts.label}: attempt ended`, closedAttempt?.ended_at != null, true);
		assert(`B ${opts.label}: current_streak reset`, team?.current_streak, 0);

		if (opts.withInsurance) {
			// base 20 → floored to floor(20*0.5)=10; final = round(10 * diff(1.0)) = 10.
			assert(`B ${opts.label}: score floored to 50%`, sub?.score, 10);
			const { data: eff } = await db
				.from('team_effects')
				.select('consumed_at')
				.eq('id', insuranceId!)
				.maybeSingle();
			assert(`B ${opts.label}: insurance consumed`, eff?.consumed_at != null, true);
		} else {
			assert(`B ${opts.label}: score 0 (empty draft)`, sub?.score, 0);
		}
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

	console.log(`▶ Regression + backstop verification against ${BOT_BASE_URL}`);
	console.log(`  set: ${SET_ID}  profile: ace (accuracy 1.0)\n`);

	const preRunConfig = await stashConfig(db);
	const browser = await chromium.launch();
	try {
		console.log('  Phase A: interactive regression (ace plays the full set) …');
		await phaseA(db, browser);
		console.log('  Phase B1: backstop plain (timeout → score 0, streak reset) …');
		await backstopRun(db, browser, { withInsurance: false, label: 'plain' });
		console.log('  Phase B2: backstop insurance (timeout → floor 50%, consumed) …');
		await backstopRun(db, browser, { withInsurance: true, label: 'insurance' });
	} finally {
		await browser.close();
		// Hygiene: leave the set clean, restoring the PRE-RUN config — not a
		// hardcoded default — so a host's manual console settings survive.
		await softReset(db);
		await db
			.from('game_sets')
			.update({ powerups_enabled: true, powerup_config: preRunConfig })
			.eq('id', SET_ID);
		console.log('↩ restored powerup_config to its pre-run state + reset the set\n');
	}

	// ── Report ────────────────────────────────────────────────────────────────
	console.log('─── Results ───');
	for (const c of checks) {
		console.log(`  ${c.pass ? '✅' : '❌'} ${c.name.padEnd(42)} ${c.pass ? '' : c.detail}`);
	}
	const passed = checks.filter((c) => c.pass).length;
	console.log(`\n${passed}/${checks.length} checks passed`);
	console.log(
		'\n(Manual-only: grace-window edge timing + time_boost deadline extension — see file header.)'
	);
	if (passed !== checks.length) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
