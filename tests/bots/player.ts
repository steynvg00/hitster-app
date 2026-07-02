// A single simulated player ("bot"). Each Player owns an isolated browser
// context (its own cookie jar), so N players onboard and join independently —
// exactly like N real phones.
//
// Two entry points:
//   - run(setId)  → onboard + join, then close the context (used by run-join).
//   - join(setId) → onboard + join but LEAVE the context open, so the caller
//                   can keep playing challenges with the same session cookies
//                   (used by run-play). Call close() when done.
//
// Phase 1 scope: onboard → join a *random-mode* set → land on /team.
// Selectable mode is intentionally not driven in v1 (see join()).

import type { Browser, BrowserContext, Page } from '@playwright/test';
import { BOT_BASE_URL } from './config';

export type JoinResult =
	| { name: string; status: 'joined'; team: string; teamName: string }
	| { name: string; status: 'selectable-skipped' }
	| { name: string; status: 'blocked'; reason: string };

export class Player {
	context?: BrowserContext;
	page?: Page;
	/** Assigned team color, set on a successful join. */
	team?: string;

	constructor(
		public readonly name: string,
		private readonly browser: Browser
	) {}

	/** Onboard + join, leaving the context open for a later play phase. */
	async join(setId: string): Promise<JoinResult> {
		// Isolated context = isolated cookies, one per bot.
		this.context = await this.browser.newContext();
		this.page = await this.context.newPage();
		const page = this.page;

		// ── Onboard ────────────────────────────────────────────────────────────
		// Land on the team onboarding page with ?next pointing at the set join.
		// After a valid name is submitted, the server sets hitster_player and
		// redirects to `next` (= the join page).
		const next = `/sets/${setId}/join`;
		await page.goto(`${BOT_BASE_URL}/play/teams?next=${encodeURIComponent(next)}`);

		// Name must be 2–30 chars. Photo is entirely optional — we skip it.
		await page.fill('#player-name', this.name);

		// Submitting kicks off a chain of server-side redirects:
		//   /play/teams  → (next) /sets/[id]/join  → random mode auto-assigns →
		//   /play/teams/randomizing?team=<color>
		// For selectable mode the browser instead *stops* on /sets/[id]/join
		// (the picker renders). If the set isn't joinable we may land on
		// /sets/[id]/in-progress or /sets/[id]/over instead.
		await Promise.all([
			page.waitForURL(
				/\/play\/teams\/randomizing|\/sets\/[^/]+\/(join|in-progress|over)/,
				{ timeout: 20_000 }
			),
			page.click('button[type="submit"]')
		]);

		const landedUrl = page.url();

		// ── Blocked states ─────────────────────────────────────────────────────
		if (landedUrl.includes('/in-progress')) {
			return { name: this.name, status: 'blocked', reason: 'game already in progress' };
		}
		if (landedUrl.includes('/over')) {
			return { name: this.name, status: 'blocked', reason: 'game over (recap)' };
		}

		// ── Selectable mode (not supported in v1) ────────────────────────────────
		if (/\/sets\/[^/]+\/join/.test(landedUrl)) {
			console.log(`[${this.name}] selectable not supported in v1 — use a random test set`);
			return { name: this.name, status: 'selectable-skipped' };
		}

		// ── Random mode: read the assigned team color from the query param ────────
		const assignedColor = new URL(landedUrl).searchParams.get('team') ?? '';
		this.team = assignedColor;

		// The randomizing screen is a pure client animation ending in an
		// <a href="/team">. We don't need to wait it out — go straight to /team.
		await page.goto(`${BOT_BASE_URL}/team`);
		await page.waitForURL(/\/team$/, { timeout: 20_000 });

		// Assert a team was actually assigned: /team renders the team name in an
		// <h1>. (If the team cookie were missing, /team redirects to /join.)
		const teamName = (await page.locator('h1').first().innerText()).trim();
		if (!teamName) {
			throw new Error('Landed on /team but no team name rendered');
		}

		return { name: this.name, status: 'joined', team: assignedColor, teamName };
	}

	/** Close the browser context (and its cookies). Idempotent. */
	async close(): Promise<void> {
		if (this.context) {
			await this.context.close();
			this.context = undefined;
			this.page = undefined;
		}
	}

	/** Onboard + join, then immediately close the context (Phase-1 join slice). */
	async run(setId: string): Promise<JoinResult> {
		try {
			return await this.join(setId);
		} finally {
			await this.close();
		}
	}
}
