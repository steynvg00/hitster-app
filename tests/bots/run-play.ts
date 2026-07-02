// Entrypoint: N bots onboard + join a random-mode set, wait for the host to
// start the game, then each bot (one team) plays every challenge on its /team
// list per its assigned PROFILE.
//
//   npm run bots:play -- --set <uuid> [--count N] [--profiles ace,mid,sloppy,lazy] [--accuracy 0..1] [--fixtures path]
//
// Requires: app running (BOT_BASE_URL, default http://localhost:5173) and a set
// with status=active, play_state=joining, team_selection_mode=random.
// After the bots join, the HOST must start the game (play_state → playing) and
// have at least one challenge active — the bots poll until then.
//
// Ground truth is auto-loaded from tests/bots/fixtures/<setId>.json (generate it
// with `npm run bots:fixtures -- --set <uuid> --ensure-pool`). If it's missing,
// bots fall back to garbage answers.

import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Player } from './player';
import { playChallenge, type PlayOutcome } from './challenge';
import { loadFixtures, fixtureMap, type FixtureFile } from './fixtures';
import { assignProfiles } from './personality';
import { BOT_BASE_URL, parseSetId, parseCount, parseFixturesPath } from './config';

const INTENT_MARK: Record<string, string> = { correct: '✓', wrong: '✗', garbage: '?' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read the ordered list of playable challenges from a /team page. */
async function readChallengeList(page: Page): Promise<Array<{ id: string; variant: string }>> {
	return page.locator('a[href^="/challenge/"]').evaluateAll((links: Element[]) =>
		links.map((a) => {
			const href = a.getAttribute('href') ?? '';
			const id = href.split('/').pop() ?? '';
			const card = a.closest('div');
			const variantEl = card?.querySelector('.capitalize');
			return { id, variant: (variantEl?.textContent ?? '').trim() };
		})
	);
}

/**
 * Poll /team until the host has started the game and a challenge is playable
 * (its pre-game start gate appears). Returns true once playable, false on
 * timeout. Prints a hint when a listed challenge isn't active yet.
 */
async function waitForPlayable(page: Page, timeoutMs = 120_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	const hinted = new Set<string>();

	while (Date.now() < deadline) {
		await page.goto(`${BOT_BASE_URL}/team`);
		const list = await readChallengeList(page);

		if (list.length === 0) {
			// Still in the lobby (play_state = joining) — no challenges shown yet.
			await sleep(3_000);
			continue;
		}

		for (const { id } of list) {
			await page.goto(`${BOT_BASE_URL}/challenge/${id}`);
			if (await page.locator('form[action="?/startChallenge"]').count()) return true;
			if (await page.getByRole('heading', { name: 'Results' }).count()) return true;
			if (await page.locator('form[action="?/submit"]').count()) return true;
			if (!hinted.has(id)) {
				console.log(`   ↪ challenge ${id} isn't active yet — activate challenge ${id} in admin`);
				hinted.add(id);
			}
		}
		await sleep(3_000);
	}
	return false;
}

/** Load fixtures for a set, warning + falling back to empty if absent. */
function loadFixturesForSet(argv: string[], setId: string): FixtureFile {
	const path = parseFixturesPath(argv, `tests/bots/fixtures/${setId}.json`);
	try {
		return loadFixtures(path);
	} catch {
		console.warn(
			`⚠  No fixtures at ${path} — bots will answer everything as garbage.\n` +
				`   Generate ground truth first: npm run bots:fixtures -- --set ${setId} --ensure-pool`
		);
		return { setId, challenges: [] };
	}
}

async function main() {
	const setId = parseSetId(process.argv);
	const count = parseCount(process.argv, 1);
	const profiles = assignProfiles(process.argv, count);
	const fixtures = loadFixturesForSet(process.argv, setId);
	const fx = fixtureMap(fixtures);

	console.log(`▶ Launching ${count} play bot(s) against ${BOT_BASE_URL}`);
	console.log(
		`  set: ${setId}  profiles: ${profiles.map((p) => p.name).join(', ')}  ` +
			`fixtures: ${fixtures.challenges.length} challenge(s)\n`
	);

	const browser = await chromium.launch();
	const players = Array.from({ length: count }, (_, i) => new Player(`Bot ${i + 1}`, browser));
	try {

		// ── Join ────────────────────────────────────────────────────────────────
		const joins = await Promise.all(
			players.map((p) =>
				p.join(setId).catch((err) => {
					console.log(`  ✗ ${p.name} → join error: ${err instanceof Error ? err.message : err}`);
					return null;
				})
			)
		);
		// Pair each joined bot with its profile (same index as launch order).
		const joined = players
			.map((player, i) => ({ player, profile: profiles[i] }))
			.filter((_, i) => joins[i]?.status === 'joined');
		for (const { player, profile } of joined) {
			console.log(`  ✓ ${player.name} joined → ${player.team} [${profile.name}]`);
		}

		if (joined.length === 0) {
			console.log('\nNo bots joined — need a random-mode, joinable (play_state=joining) set. Aborting.');
			return;
		}

		console.log(
			`\n✅ ${joined.length} bots joined — start the game as host now, polling for playable…`
		);

		// ── Wait for the host to start + a challenge to go active ────────────────
		const playable = await waitForPlayable(joined[0].player.page!);
		if (!playable) {
			console.log(
				'\n⏱  Timed out waiting for a playable challenge. Start the game (play_state → playing) and activate a challenge in admin, then re-run.'
			);
			return;
		}

		// ── Play: bots in parallel, challenges sequential per bot ────────────────
		console.log('\n─── Playing ───');
		const summaries = await Promise.all(
			joined.map(async ({ player, profile }) => {
				const page = player.page!;
				const teamKey = player.team ?? player.name;
				await page.goto(`${BOT_BASE_URL}/team`);
				const list = await readChallengeList(page);
				console.log(`  ${player.name} (${player.team}) [${profile.name}] sees ${list.length} challenge(s)`);

				const outcomes: PlayOutcome[] = [];
				for (const { id, variant } of list) {
					const entry = fx.get(id);
					const challenge = {
						id,
						variant: entry?.variant ?? variant,
						fields: entry?.fields ?? {},
						accepted_titles: entry?.accepted_titles
					};
					outcomes.push(await playChallenge(page, challenge, profile, teamKey));
				}
				return { name: player.name, team: player.team, profile: profile.name, outcomes };
			})
		);

		// ── Per-bot summary: team, profile, per-field intents, submit/lazy ───────
		console.log('\n─── Summary ───');
		for (const s of summaries) {
			const submitted = s.outcomes.filter((o) => o.submitted).length;
			const lazy = s.outcomes.filter((o) => o.lazy).length;
			console.log(
				`  ${s.name} (${s.team}) [${s.profile}] — ${s.outcomes.length} listed · ` +
					`${submitted} submitted${lazy ? ` · ${lazy} lazy (auto-submit)` : ''}`
			);
			for (const o of s.outcomes) {
				if (o.lazy) {
					console.log(`      ${o.id} (${o.variant}): lazy — no submit`);
				} else if (o.skipped) {
					console.log(`      ${o.id} (${o.variant}): skipped — ${o.skipped}`);
				} else {
					const marks = o.fields
						.map((f) => `${f.field}${INTENT_MARK[f.intended] ?? '?'}${f.filled ? '' : '∅'}`)
						.join(' ');
					console.log(
						`      ${o.id} (${o.variant}): ${marks} → ${o.submitted ? 'submitted' : 'no results'}`
					);
				}
			}
		}
	} finally {
		await Promise.all(players.map((p) => p.close()));
		await browser.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
