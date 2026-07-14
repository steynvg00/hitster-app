// The play engine: drive one challenge from the pre-game gate through submit.
//
// v1 handles single-tab field variants only: standard, label, anthem, effects
// (one source track, fields per VARIANT_FIELDS). mashup / fragments / any
// multi-tab challenge is logged as "not handled in v1 — deferred" and skipped.
//
// The server reads ONLY the `answers_json` hidden input, which the page builds
// from the components' bound Svelte state — so we must drive the REAL controls
// (text input / range / option buttons), not the hidden inputs.

import type { Page, Locator } from '@playwright/test';
import { BOT_BASE_URL } from './config';
import type { FixtureChallenge, FixtureFields } from './fixtures';
import { type Profile, fieldIsCorrect } from './personality';

// Field lists per variant (mirrors src/lib/server/scoring.ts VARIANT_FIELDS).
// Kept local so the bot doesn't need SvelteKit's $lib alias resolution.
const VARIANT_FIELDS: Record<string, string[]> = {
	standard: ['artist', 'title', 'year'],
	label: ['label', 'artist', 'title', 'year'],
	anthem: ['festival', 'artist', 'title', 'year'],
	effects: ['artist', 'title', 'year'],
	mashup: ['artist', 'title', 'year'],
	fragments: ['artist', 'title', 'year', 'grouping']
};

const HANDLED_VARIANTS = new Set(['standard', 'label', 'anthem', 'effects']);

const YEAR_MIN = 2000;
const YEAR_MAX = 2026;
const TEXT_DECOY = 'The Decoy Answer';

type InputMode = 'slider' | 'typeable_number' | 'open_text' | 'combobox' | 'multiple_choice';

export type Intent = 'correct' | 'wrong' | 'garbage';

export interface FieldPlay {
	field: string;
	// ControlKind, not InputMode: the artist field renders as a tag input (see
	// ControlKind below), which is a rendering choice, not a field input_mode.
	mode: ControlKind | null;
	intended: Intent;
	filled: boolean; // false when the control couldn't confirm the value (e.g. combobox miss)
}

export interface PlayOutcome {
	id: string;
	variant: string;
	played: boolean; // fields were filled + submit attempted
	submitted: boolean; // results screen rendered
	lazy: boolean; // attempt created but deliberately not submitted
	skipped?: string; // reason, when played === false
	fields: FieldPlay[]; // per-field intents (non-lazy, handled challenges)
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry a field interaction that can fail because Svelte's {#key activeTabIndex}
 * block (see CLAUDE.md) remounts the whole field set — on the post-startChallenge
 * `window.location.reload()` settling, and again on any tab/slot switch. Each
 * attempt re-resolves its locators from scratch (the caller re-queries inside
 * `action`), so a stale/detached handle never survives into a retry.
 */
async function withRemountRetry<T>(action: () => Promise<T>, attempts = 3): Promise<T> {
	let lastErr: unknown;
	for (let i = 0; i < attempts; i++) {
		try {
			return await action();
		} catch (err) {
			lastErr = err;
			if (i < attempts - 1) await sleep(250);
		}
	}
	throw lastErr;
}

/**
 * Post-fill assertion: a fill that "succeeded" (no thrown error) can still
 * leave the control empty if the app silently discarded the typed value —
 * e.g. a Svelte binding that isn't wired for a given mode. Surface that in
 * the run log instead of only showing up later as a 0-score submission in
 * the DB.
 */
function confirmFilled(name: string, confirmed: string): { filled: boolean; note?: string } {
	if (!confirmed) {
		console.warn(`      ⚠ ${name}: filled but read back empty — value was not confirmed`);
		return { filled: false, note: 'read-back empty after fill' };
	}
	return { filled: true };
}

function truthFor(field: string, fields: FixtureFields | undefined): string | undefined {
	const key = field === 'label' ? 'record_label' : field;
	const v = fields?.[key as keyof FixtureFields];
	return v === undefined || v === null || v === '' ? undefined : String(v);
}

/**
 * Value to type for a field given whether this bot should answer it correctly.
 * Wrong answers are deterministic FAR decoys (year ±5 → outside the ±2 window,
 * text → a fixed decoy that can't fuzzy-match) so they score exactly 0. No
 * ground truth at all → garbage (unknown track).
 */
function valueFor(
	field: string,
	fields: FixtureFields | undefined,
	correct: boolean
): { value: string; intended: Intent } {
	const truth = truthFor(field, fields);

	if (truth === undefined) {
		return { value: field === 'year' ? String(YEAR_MIN) : 'zzzzzz', intended: 'garbage' };
	}
	if (correct) return { value: truth, intended: 'correct' };

	if (field === 'year') {
		const y = parseInt(truth, 10);
		let w = clamp(y + 5, YEAR_MIN, YEAR_MAX);
		if (w === y) w = clamp(y - 5, YEAR_MIN, YEAR_MAX);
		return { value: String(w), intended: 'wrong' };
	}
	return { value: TEXT_DECOY, intended: 'wrong' };
}

/**
 * A control KIND as the harness sees it. Superset of the app's InputMode: `tags`
 * isn't a field input_mode, it's how the artist field RENDERS (ArtistTagInput) in
 * both open_text and combobox mode since C1 stuk 2.
 */
type ControlKind = InputMode | 'tags';

/** Detect the control kind by its `name`, reading the live DOM. */
async function detectMode(page: Page, name: string): Promise<ControlKind | null> {
	if (await page.locator(`input[type="range"][name="${name}"]`).count()) return 'slider';
	if (await page.locator(`input[type="number"][name="${name}"]`).count()) return 'typeable_number';
	// OpenText binds the name directly onto a visible text input.
	if (await page.locator(`input[type="text"][name="${name}"]`).count()) return 'open_text';

	// Tag input FIRST: it also pairs a hidden input with a visible text box, so the
	// combobox branch below would otherwise claim it — and then "fill + click the
	// exact option" would silently leave it empty in open_text mode, where the tag
	// input deliberately offers no suggestions to click.
	if (await page.locator(`input[type="hidden"][data-tag-input][name="${name}"]`).count()) {
		return 'tags';
	}

	// Combobox + MultipleChoice both expose a hidden input carrying the name.
	// Combobox additionally has a sibling visible text input; MultipleChoice
	// has option buttons instead.
	const hidden = page.locator(`input[type="hidden"][name="${name}"]`);
	if (await hidden.count()) {
		const container = hidden.locator('xpath=..');
		if (await container.locator('input[type="text"]').count()) return 'combobox';
		return 'multiple_choice';
	}
	return null;
}

/**
 * Resolve a VARIANT_FIELD to the actual control name + mode. The `artist` field
 * renders as the collab combobox (name `artist_slot_0_0`) whenever its mode is
 * combobox (the default), so we try that fallback name.
 *
 * Polls instead of a one-shot check, so a field that genuinely mounts a beat
 * late (e.g. still settling after the post-startChallenge remount) isn't
 * misreported as "not found". Note: a one-shot .count() was NOT the cause of
 * the multi-field "control not found" runs diagnosed on the mechanics-test
 * set — that turned out to be a real app crash (year field mode = open_text
 * threw props_invalid_value on bind:value={undefined} during hydration,
 * taking the whole field block down — see fix/year-open-text-crash). This
 * poll is a genuine, separate robustness improvement for actual timing races,
 * kept because it's still correct, just doesn't explain that particular bug.
 */
async function resolveField(
	page: Page,
	field: string,
	timeoutMs = 4000
): Promise<{ name: string; mode: ControlKind } | null> {
	// artist renders as ArtistTagInput (C1 stuk 2): `artist` in the single-slot
	// layout, `artist_0` in the multi-slot one. `artist_slot_0_0` was the old
	// collab-combobox name, gone with that UI — kept only so a bot run against an
	// older build still resolves.
	const candidates = field === 'artist' ? ['artist', 'artist_0', 'artist_slot_0_0'] : [field];
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		for (const name of candidates) {
			const mode = await detectMode(page, name);
			if (mode) return { name, mode };
		}
		if (Date.now() >= deadline) return null;
		await sleep(150);
	}
}

async function fillControl(
	page: Page,
	name: string,
	mode: ControlKind,
	value: string
): Promise<{ filled: boolean; note?: string }> {
	switch (mode) {
		// ArtistTagInput (C1 stuk 2). Type each name and press Enter to commit it as
		// a tag — a plain fill() would leave the text sitting in the query box and
		// the hidden wire value empty. Multi-artist values arrive '\n'-separated
		// (the scorer's wire format), so split on that and add one tag per name.
		case 'tags': {
			let confirmed = '';
			await withRemountRetry(async () => {
				const hidden = page.locator(`input[type="hidden"][name="${name}"]`);
				const container = hidden.locator('xpath=..');
				const text = container.locator('input[type="text"]');
				await text.waitFor({ state: 'visible' });
				for (const tag of value.split('\n').map((t) => t.trim()).filter(Boolean)) {
					await text.fill(tag);
					await text.press('Enter');
				}
				// Read the hidden input, not the chips: it's the exact value that
				// reaches the scorer, so this asserts the wire format end to end.
				confirmed = await hidden.inputValue();
			});
			return confirmed.trim()
				? { filled: true }
				: { filled: false, note: 'tag input stayed empty' };
		}

		case 'open_text': {
			let confirmed = '';
			await withRemountRetry(async () => {
				const field = page.locator(`input[type="text"][name="${name}"]`);
				await field.waitFor({ state: 'visible' });
				await field.fill(value);
				confirmed = await field.inputValue();
			});
			return confirmFilled(name, confirmed);
		}

		case 'typeable_number': {
			let confirmed = '';
			await withRemountRetry(async () => {
				const field = page.locator(`input[type="number"][name="${name}"]`);
				await field.waitFor({ state: 'visible' });
				await field.fill(value);
				confirmed = await field.inputValue();
			});
			return confirmFilled(name, confirmed);
		}

		case 'slider': {
			// Playwright's fill() doesn't drive <input type=range>; set the value via
			// the native setter + dispatch input/change so Svelte's bind:value reacts.
			let confirmed = '';
			await withRemountRetry(async () => {
				const field = page.locator(`input[type="range"][name="${name}"]`);
				await field.waitFor({ state: 'visible' });
				await field.evaluate((el, v) => {
					const input = el as HTMLInputElement;
					const setter = Object.getOwnPropertyDescriptor(
						HTMLInputElement.prototype,
						'value'
					)?.set;
					setter?.call(input, String(v));
					input.dispatchEvent(new Event('input', { bubbles: true }));
					input.dispatchEvent(new Event('change', { bubbles: true }));
				}, value);
				confirmed = await field.inputValue();
			});
			return confirmFilled(name, confirmed);
		}

		case 'combobox': {
			let matched = false;
			await withRemountRetry(async () => {
				const hidden = page.locator(`input[type="hidden"][name="${name}"]`);
				const container = hidden.locator('xpath=..');
				const text = container.locator('input[type="text"]');
				await text.waitFor({ state: 'visible' });
				await text.fill(value);
				// The confirmed value only sticks on an exact option match (typing
				// alone leaves it blank). The option list re-renders on every
				// keystroke, so re-query it fresh right before clicking rather than
				// reusing a locator captured before the fill.
				const option = container.getByRole('button', { name: value, exact: true });
				matched = (await option.count()) > 0;
				if (matched) await option.first().click();
			});
			return matched
				? { filled: true }
				: { filled: false, note: 'no matching combobox option — left blank' };
		}

		case 'multiple_choice': {
			let matched = false;
			await withRemountRetry(async () => {
				const hidden = page.locator(`input[type="hidden"][name="${name}"]`);
				const container = hidden.locator('xpath=..');
				const option = container.getByRole('button', { name: value, exact: true });
				matched = (await option.count()) > 0;
				if (matched) await option.first().click();
			});
			return matched
				? { filled: true }
				: { filled: false, note: 'no matching choice option — skipped' };
		}
	}
}

/** True if the in-game form indicates a multi-tab challenge (deferred in v1). */
async function isMultiTab(page: Page): Promise<boolean> {
	// The multi-tab strip renders buttons literally labelled "Tab 1", "Tab 2"…
	const tabButtons = page.getByRole('button', { name: /^Tab \d+$/ });
	return (await tabButtons.count()) > 1;
}

const results = (page: Page): Locator => page.getByRole('heading', { name: 'Results' });

/**
 * Play one challenge end-to-end for one bot, per its profile.
 *
 * All bots know the full ground truth; the profile decides, per field, whether
 * to give the correct value or a deterministic far decoy (seeded on team +
 * challenge + field). A `lazy` profile clears the start gate then leaves without
 * submitting, so the host-side auto-submit fires on the timer.
 *
 * Never throws for expected states (ended / already submitted / deferred).
 */
export async function playChallenge(
	page: Page,
	challenge: FixtureChallenge,
	profile: Profile,
	teamKey: string
): Promise<PlayOutcome> {
	const { id, variant } = challenge;
	const base: PlayOutcome = { id, variant, played: false, submitted: false, lazy: false, fields: [] };

	if (!HANDLED_VARIANTS.has(variant)) {
		console.log(`    ⤼ challenge ${id} (${variant}): not handled in v1 — deferred`);
		return { ...base, skipped: `variant ${variant} deferred` };
	}

	await page.goto(`${BOT_BASE_URL}/challenge/${id}`);
	await page.waitForLoadState('domcontentloaded');

	// Already submitted → results screen renders straight away.
	if (await results(page).count()) {
		console.log(`    ✓ challenge ${id}: already submitted`);
		return { ...base, submitted: true, skipped: 'already submitted' };
	}

	// Challenge closed by host.
	if (await page.getByText('This challenge has ended').count()) {
		console.log(`    ⤼ challenge ${id}: ended — skipped`);
		return { ...base, skipped: 'challenge ended' };
	}

	// Pre-game gate → start it (creates the attempt), then wait for the in-game
	// submit form to mount.
	const submitForm = page.locator('form[action="?/submit"]');
	const gate = page.locator('form[action="?/startChallenge"]');
	if (await gate.count()) {
		await gate.locator('button[type="submit"]').click();
		try {
			await submitForm.waitFor({ timeout: 20_000 });
		} catch {
			console.log(`    ⤼ challenge ${id}: start gate didn't advance — skipped`);
			return { ...base, skipped: 'start gate stuck' };
		}
		// The gate's success handler does a full window.location.reload() to remount
		// the timer (see CLAUDE.md "Challenge start gate"). The in-game form's
		// {#key activeTabIndex} field block can still be settling for a beat right
		// after the reload — avoid using networkidle here since the realtime
		// websocket keeps the network non-idle indefinitely; a short fixed pause is
		// enough, and fillControl's own retry wrapper covers anything left over.
		await sleep(400);
	} else if (!(await submitForm.count())) {
		console.log(`    ⤼ challenge ${id}: no start gate or form (not active?) — skipped`);
		return { ...base, skipped: 'no gate/form' };
	}

	// Lazy: attempt is now created; deliberately never submit → host auto-submit.
	if (profile.lazy) {
		console.log(`    ⏸ challenge ${id}: lazy — attempt created, no submit (host will auto-submit)`);
		return { ...base, lazy: true };
	}

	// Deferred: multi-tab challenges.
	if (await isMultiTab(page)) {
		console.log(`    ⤼ challenge ${id}: multi-tab — not handled in v1 — deferred`);
		return { ...base, skipped: 'multi-tab deferred' };
	}

	// ── Fill each field per the seeded correct/wrong decision ────────────────
	const played: FieldPlay[] = [];
	for (const field of VARIANT_FIELDS[variant] ?? []) {
		if (field === 'grouping') continue; // fragments-only, not reached here
		const resolved = await resolveField(page, field);
		const correct = fieldIsCorrect(profile, teamKey, id, field);
		const { value, intended } = valueFor(field, challenge.fields, correct);

		if (!resolved) {
			console.log(`      · ${field}: control not found — skipped`);
			played.push({ field, mode: null, intended, filled: false });
			continue;
		}
		const res = await fillControl(page, resolved.name, resolved.mode, value);
		const suffix = res.filled ? '' : ` (${res.note})`;
		console.log(`      · ${field} [${resolved.mode}] ← "${value}" (${intended})${suffix}`);
		played.push({ field, mode: resolved.mode, intended, filled: res.filled });
	}

	// ── Submit + wait for results ───────────────────────────────────────────
	await submitForm.locator('button[type="submit"]').click();
	let submitted = false;
	try {
		await results(page).waitFor({ timeout: 15_000 });
		submitted = true;
	} catch {
		const err = await page.locator('.bg-red-900\\/30').first().innerText().catch(() => '');
		console.log(`    ✗ challenge ${id}: no results screen${err ? ` — ${err.trim()}` : ''}`);
	}
	if (submitted) console.log(`    ✓ challenge ${id}: submitted, results rendered`);

	return { ...base, played: true, submitted, fields: played };
}
