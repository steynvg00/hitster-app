// Entrypoint: N bots onboard + join a random-mode set, wait for the host to
// start the game, then each bot plays every challenge on its /team list.
//
//   npm run bots:play -- --set <uuid> [--count N] [--accuracy correct|wrong|garbage] [--fixtures path]
//
// Requires: app running (BOT_BASE_URL, default http://localhost:5173) and a set
// with status=active, play_state=joining, team_selection_mode=random.
// After the bots join, the HOST must start the game (play_state → playing) and
// have at least one challenge active — the bots poll until then.

import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Player } from './player';
import { playChallenge } from './challenge';
import { loadFixtures, fixtureMap } from './fixtures';
import { parseAccuracy } from './personality';
import { BOT_BASE_URL, parseSetId, parseCount, parseFixturesPath } from './config';

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

async function main() {
	const setId = parseSetId(process.argv);
	const count = parseCount(process.argv, 1);
	const accuracy = parseAccuracy(process.argv);
	const fixtures = loadFixtures(parseFixturesPath(process.argv));
	const fx = fixtureMap(fixtures);
	const plan = { accuracy };

	console.log(`▶ Launching ${count} play bot(s) against ${BOT_BASE_URL}`);
	console.log(`  set: ${setId}  accuracy: ${accuracy}  fixtures: ${fixtures.challenges.length} challenge(s)\n`);

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
		const joined = players.filter((_, i) => joins[i]?.status === 'joined');
		for (const p of joined) console.log(`  ✓ ${p.name} joined → ${p.team}`);

		if (joined.length === 0) {
			console.log('\nNo bots joined — need a random-mode, joinable (play_state=joining) set. Aborting.');
			return;
		}

		console.log(
			`\n✅ ${joined.length} bots joined — start the game as host now, polling for playable…`
		);

		// ── Wait for the host to start + a challenge to go active ────────────────
		const playable = await waitForPlayable(joined[0].page!);
		if (!playable) {
			console.log(
				'\n⏱  Timed out waiting for a playable challenge. Start the game (play_state → playing) and activate a challenge in admin, then re-run.'
			);
			return;
		}

		// ── Play: bots in parallel, challenges sequential per bot ────────────────
		console.log('\n─── Playing ───');
		const summaries = await Promise.all(
			joined.map(async (p) => {
				const page = p.page!;
				await page.goto(`${BOT_BASE_URL}/team`);
				const list = await readChallengeList(page);
				console.log(`  ${p.name} (${p.team}) sees ${list.length} challenge(s)`);

				let played = 0;
				let submitted = 0;
				for (const { id, variant } of list) {
					const entry = fx.get(id);
					const challenge = {
						id,
						variant: entry?.variant ?? variant,
						fields: entry?.fields ?? {},
						accepted_titles: entry?.accepted_titles
					};
					const outcome = await playChallenge(page, challenge, plan);
					if (outcome.played) played++;
					if (outcome.submitted) submitted++;
				}
				return { name: p.name, team: p.team, seen: list.length, played, submitted };
			})
		);

		console.log('\n─── Summary ───');
		for (const s of summaries) {
			console.log(
				`  ${s.name} (${s.team}): ${s.seen} listed · ${s.played} played · ${s.submitted} submitted`
			);
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
