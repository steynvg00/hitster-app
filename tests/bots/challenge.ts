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
import type { Plan } from './personality';

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

export interface PlayOutcome {
	id: string;
	variant: string;
	played: boolean; // fields were filled + submit attempted
	submitted: boolean; // results screen rendered
	skipped?: string; // reason, when played === false
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function truthFor(field: string, fields: FixtureFields | undefined): string | undefined {
	const key = field === 'label' ? 'record_label' : field;
	const v = fields?.[key as keyof FixtureFields];
	return v === undefined || v === null || v === '' ? undefined : String(v);
}

/** Compute the value to type for a field, per accuracy. */
function computeValue(
	field: string,
	fields: FixtureFields | undefined,
	accuracy: Plan['accuracy']
): { value: string; kind: 'correct' | 'wrong' | 'garbage' } {
	const truth = truthFor(field, fields);

	// No ground truth, or explicitly garbage → unknown answer.
	if (accuracy === 'garbage' || truth === undefined) {
		return { value: field === 'year' ? String(YEAR_MIN) : 'zzzzzz', kind: 'garbage' };
	}

	if (accuracy === 'correct') return { value: truth, kind: 'correct' };

	// wrong — deterministic decoy
	if (field === 'year') {
		const y = parseInt(truth, 10);
		let w = clamp(y + 5, YEAR_MIN, YEAR_MAX);
		if (w === y) w = clamp(y - 5, YEAR_MIN, YEAR_MAX);
		return { value: String(w), kind: 'wrong' };
	}
	return { value: TEXT_DECOY, kind: 'wrong' };
}

/** Detect the input mode of a control by its `name`, reading the live DOM. */
async function detectMode(page: Page, name: string): Promise<InputMode | null> {
	if (await page.locator(`input[type="range"][name="${name}"]`).count()) return 'slider';
	if (await page.locator(`input[type="number"][name="${name}"]`).count()) return 'typeable_number';
	// OpenText binds the name directly onto a visible text input.
	if (await page.locator(`input[type="text"][name="${name}"]`).count()) return 'open_text';

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
 */
async function resolveField(
	page: Page,
	field: string
): Promise<{ name: string; mode: InputMode } | null> {
	const candidates = field === 'artist' ? ['artist', 'artist_slot_0_0'] : [field];
	for (const name of candidates) {
		const mode = await detectMode(page, name);
		if (mode) return { name, mode };
	}
	return null;
}

async function fillControl(
	page: Page,
	name: string,
	mode: InputMode,
	value: string
): Promise<{ filled: boolean; note?: string }> {
	switch (mode) {
		case 'open_text':
			await page.fill(`input[type="text"][name="${name}"]`, value);
			return { filled: true };

		case 'typeable_number':
			await page.fill(`input[type="number"][name="${name}"]`, value);
			return { filled: true };

		case 'slider': {
			// Playwright's fill() doesn't drive <input type=range>; set the value via
			// the native setter + dispatch input/change so Svelte's bind:value reacts.
			await page.locator(`input[type="range"][name="${name}"]`).evaluate((el, v) => {
				const input = el as HTMLInputElement;
				const setter = Object.getOwnPropertyDescriptor(
					HTMLInputElement.prototype,
					'value'
				)?.set;
				setter?.call(input, String(v));
				input.dispatchEvent(new Event('input', { bubbles: true }));
				input.dispatchEvent(new Event('change', { bubbles: true }));
			}, value);
			return { filled: true };
		}

		case 'combobox': {
			const hidden = page.locator(`input[type="hidden"][name="${name}"]`);
			const container = hidden.locator('xpath=..');
			await container.locator('input[type="text"]').fill(value);
			// The confirmed value only sticks on an exact option match (typing alone
			// leaves it blank). Click the matching dropdown option if present.
			const option = container.getByRole('button', { name: value, exact: true });
			if (await option.count()) {
				await option.first().click();
				return { filled: true };
			}
			return { filled: false, note: 'no matching combobox option — left blank' };
		}

		case 'multiple_choice': {
			const hidden = page.locator(`input[type="hidden"][name="${name}"]`);
			const container = hidden.locator('xpath=..');
			const option = container.getByRole('button', { name: value, exact: true });
			if (await option.count()) {
				await option.first().click();
				return { filled: true };
			}
			return { filled: false, note: 'no matching choice option — skipped' };
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
 * Play one challenge end-to-end. Returns an outcome describing what happened.
 * Never throws for expected states (ended / already submitted / deferred).
 */
export async function playChallenge(
	page: Page,
	challenge: FixtureChallenge,
	plan: Plan
): Promise<PlayOutcome> {
	const { id, variant } = challenge;
	const base: PlayOutcome = { id, variant, played: false, submitted: false };

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

	// Pre-game gate → start it, then wait for the in-game submit form to mount.
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
	} else if (!(await submitForm.count())) {
		console.log(`    ⤼ challenge ${id}: no start gate or form (not active?) — skipped`);
		return { ...base, skipped: 'no gate/form' };
	}

	// Deferred: multi-tab challenges.
	if (await isMultiTab(page)) {
		console.log(`    ⤼ challenge ${id}: multi-tab — not handled in v1 — deferred`);
		return { ...base, skipped: 'multi-tab deferred' };
	}

	// ── Fill each field ─────────────────────────────────────────────────────
	const fields = VARIANT_FIELDS[variant] ?? [];
	for (const field of fields) {
		if (field === 'grouping') continue; // fragments-only, not reached here
		const resolved = await resolveField(page, field);
		if (!resolved) {
			console.log(`      · ${field}: control not found — skipped`);
			continue;
		}
		const { value, kind } = computeValue(field, challenge.fields, plan.accuracy);
		const res = await fillControl(page, resolved.name, resolved.mode, value);
		const suffix = res.filled ? '' : ` (${res.note})`;
		console.log(
			`      · ${field} [${resolved.mode}] ← "${value}" (${kind})${suffix}`
		);
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

	return { ...base, played: true, submitted };
}
