// Client-safe powerup metadata shared between the server activation code
// (src/lib/server/powerups.ts) and the player-facing Svelte modals. Kept in its
// own module with NO server-only imports so `.svelte` files can import it too.

import type { ResurrectionScoreMode } from '$lib/types';

// Powerups that act on ANOTHER team and therefore require a target picker at
// activation. All four are live: give_a_shot (stuk 1), freeze + time_drain
// (stuk 2), tap_to_break (stuk 3 — completes the offensive powerups feature).
export const TARGETED_POWERUP_IDS = [
	'give_a_shot',
	'freeze',
	'time_drain',
	'tap_to_break'
] as const;

export function isTargetedPowerup(id: string): boolean {
	return (TARGETED_POWERUP_IDS as readonly string[]).includes(id);
}

// Timer/attempt-gated attacks — the subset of targeted powerups that need the
// target to be IN a live timed challenge right now (design B: no apply-on-next-
// challenge). The target picker greys teams without an active timed attempt for
// these; the server (resolveTargetTimedAttempt) enforces the same rule as a
// safety net. tap_to_break needs a live attempt too (locking an idle team is
// pointless) even though it doesn't touch the timer itself. give_a_shot stays
// valid against any team, so it's excluded.
export const TIMER_POWERUP_IDS = ['freeze', 'time_drain', 'tap_to_break'] as const;

export function isTimerPowerup(id: string): boolean {
	return (TIMER_POWERUP_IDS as readonly string[]).includes(id);
}

// ─── double_down prediction ──────────────────────────────────────────────────
//
// Double Down is the first powerup carrying a team-CHOSEN number from activation
// into scoring. The team predicts a percentage g before the challenge starts;
// after scoring, its achieved percentage decides which way the bet swings:
//
//   score% >= g  ->  x(1 + g/100)     hit  — the prediction earned its own size
//   score% <  g  ->  x(1 - g/100)     miss — and cost exactly as much
//
// g = 0 resolves to x1.0 on BOTH branches (0% is always >= 0, and 1 - 0 = 1), so
// "predict nothing" is a genuine no-op rather than a trap. That also disposes of
// the 0%-score edge: a team that scores nothing having predicted nothing is
// neither rewarded nor punished.
//
// Lives here, in the client-safe module, for the same reason thresholdOfFields
// lives in $lib/threshold: the scorer (src/lib/server/scoring.ts) and the
// player-facing activation modal must apply the SAME formula — the modal shows a
// live hit/miss preview of the very multiplier the scorer will compute — and a
// second copy in a .svelte file is exactly the drift C3a-2 was written to stop.
export const DOUBLE_DOWN_MIN_PCT = 0;
export const DOUBLE_DOWN_MAX_PCT = 100;

/**
 * Resolve Double Down's multiplier. Both arguments are percentages (0–100).
 * Pure; the caller decides what counts as score% (the scorer uses the
 * bonus-excluded threshold pair, the same numerator/denominator that drives
 * powerup earning).
 */
export function doubleDownMultiplier(predictedPct: number, scorePct: number): number {
	const g = Math.min(DOUBLE_DOWN_MAX_PCT, Math.max(DOUBLE_DOWN_MIN_PCT, Math.round(predictedPct)));
	const raw = scorePct >= g ? 1 + g / 100 : 1 - g / 100;
	// Snap to 2 decimals. Not cosmetic: 1 - 80/100 is 0.19999999999999996 in
	// IEEE754, and this number is PERSISTED in submissions.answers[0].breakdown
	// and rendered to the team ("×0.19999999999999996"). The rounded score is
	// unaffected either way — Math.round in computeBreakdown absorbs the epsilon —
	// but the stored and displayed multiplier must be the value the team was
	// promised. An integer g can never need more than 2 decimals.
	return Math.round(raw * 100) / 100;
}

// ─── free_answer reveal addressing ───────────────────────────────────────────
//
// A revealed answer belongs to ONE (tab, slot, field) triple, never to a field
// name alone: a multi-tab challenge has a different track per tab, and a
// multi-source tab (mashup / fragments) a different track per answer slot. The
// original reveal was keyed on the field name only, so tab 1's artist showed —
// and pre-filled — on every tab and every slot.
//
// The tab is addressed by challenge_tabs.id, NOT by position: position is not
// unique in practice (a live challenge in this database has positions
// [0,1,2,3,4,4,4,5,6,6,…]), and `ORDER BY position` with ties has no guaranteed
// row order, so neither position nor ordinal index identifies a tab reliably.
// The uuid does.
//
// This key is built in two places that MUST agree: the challenge load (rebuilding
// reveals from consumed team_effects rows) and the page (adding a reveal live
// after activation). Hence one definition here, in the client-safe module both
// sides can import.
export function freeAnswerRevealKey(tabId: string, slotIndex: number, field: string): string {
	return `${tabId}:${slotIndex}:${field}`;
}

// ─── Multi-reveal powerups (group A) ─────────────────────────────────────────
//
// x_ray and free_tab reveal SEVERAL answers from one activation. They are not a
// second reveal mechanism: every single reveal they produce is one
// (tab, slot, field) triple resolved by the same server helper free_answer uses
// (resolveFreeAnswerValue), stored as the same team_effects row, keyed by the
// same freeAnswerRevealKey, and pre-filled by the same applyRevealToDraft. The
// only difference is how many addresses go in — one, up to five, or a whole tab.
export const REVEAL_POWERUP_IDS = ['free_answer', 'x_ray', 'free_tab'] as const;

export function isRevealPowerup(id: string): boolean {
	return (REVEAL_POWERUP_IDS as readonly string[]).includes(id);
}

/**
 * x_ray: how many reveals one activation is worth when the set's config does not
 * say otherwise. A BUDGET, not a per-activation cap: X-Ray hands the team this
 * many reveals to spend one field at a time, on any tab, while it plays — no tab
 * in this game has five fields, so five reveals only make sense spread out.
 * resolveXrayBudget (src/lib/server/powerups.ts) reads the per-set override and
 * falls back to this.
 */
export const X_RAY_DEFAULT_BUDGET = 5;

/**
 * free_tab: sanity bound on how many cells one tab may hand over. Not a game
 * rule — a real tab has at most a handful of slots × fields — but the target list
 * arrives from the client, so the server needs an upper bound it can refuse
 * beyond.
 */
export const FREE_TAB_MAX_REVEALS = 40;

/** One requested reveal, as posted by the activation modal. */
export type RevealTarget = {
	tabId?: string;
	slotIndex: number;
	field: string;
};

// ─── lifeline: the masking rule ──────────────────────────────────────────────
//
// Lifeline is NOT a reveal powerup (it is deliberately absent from
// REVEAL_POWERUP_IDS above): it never writes a value into the draft and never
// hands the team an answer to accept. It hands over a MASK of the answer, and
// the team still types the real thing. That is why it does not go through
// applyRevealToDraft and why its hint renders as read-only text.
//
// The rule, in one sentence: keep the first character of every word, underscore
// the rest, leave everything that is not a word alone.
//
//   "Raiders Of Rampage"  -> "R______ O_ R______"
//   "Miss K8 & Nolz"      -> "M___ K_ & N___"
//   "D-Block & S-te-Fan"  -> "D-_____ & S-__-___"
//   "Don't Stop"          -> "D__'_ S___"
//   "2011"                -> "2___"
//
// The consequences of that rule, each a deliberate choice:
//
//   MULTIPLE WORDS  Every word is masked independently, so the word count and
//     each word's length show through. That is the hint: it is what lets a team
//     recognise a title they half-know.
//
//   &-COLLABS  The artist field's answer is already one string — correctValueForField
//     joins a track's artists[] with ' & ' — so nothing special happens here.
//     '&' is not a word character, so it survives literally and the collab
//     structure ("two acts, this one 4 letters, that one 4") is visible. Same
//     for the tag input's own display: the hint is one line of text either way,
//     so a tagged artist field needs no separate shape (unlike free_answer,
//     which must ship real tags because it FILLS the input).
//
//   PUNCTUATION  A word is a WHITESPACE-delimited token, and punctuation inside
//     one is preserved rather than underscored — so "D-Block" keeps its shape
//     ("D-_____") and "Don't" masks to "D__'_". Splitting on punctuation instead
//     would make every hyphen and apostrophe expose another letter
//     ("D-B____", "D__'t"), which hands over three letters of "S-te-Fan" and one
//     of "Don't" while a plain word gives up exactly one. One letter per word,
//     always, whatever punctuation the word happens to contain.
//
//     A token with no letters or digits at all — "&" — passes through untouched,
//     which is what keeps a collab readable as a collab.
//
//   DIGITS  A digit counts as a letter for this purpose, so "K8" -> "K_" and a
//     year "2011" -> "2___". Every year in this game starts with 2, so the year
//     hint carries almost no information. That is the honest application of one
//     uniform rule rather than a per-field exception, and it is stated here so
//     the weakness is a known property and not a surprise.
//
// Lives in this client-safe module for the same reason doubleDownMultiplier
// does: the server produces the mask and the page renders it, and a second copy
// in a .svelte file would be free to drift.
export function maskAnswer(value: string): string {
	return value.replace(/\S+/g, (word) => {
		let firstSeen = false;
		// Array.from, not indexing: a surrogate pair (an emoji or an astral-plane
		// character in a track title) is two UTF-16 units, and walking by index would
		// cut one in half and mask it as two characters.
		return Array.from(word)
			.map((ch) => {
				// Punctuation is structure, not content — it survives as itself and does
				// not count as the word's first letter.
				if (!/[\p{L}\p{N}]/u.test(ch)) return ch;
				if (!firstSeen) {
					firstSeen = true;
					return ch;
				}
				return '_';
			})
			.join('');
	});
}

/**
 * One lifeline hint, addressed exactly like a reveal — same (tab, slot, field)
 * triple, same freeAnswerRevealKey — so the page can look a hint up next to the
 * field it belongs to without a second addressing scheme.
 *
 * `mask` is the ONLY thing that crosses to the client. The unmasked answer stays
 * on the server.
 */
export type LifelineHint = {
	tabId: string;
	slotIndex: number;
	field: string;
	mask: string;
};

/**
 * The fraction of a challenge's clock that must have elapsed before Lifeline can
 * be activated. A defensive powerup for a team that is stuck — activating it in
 * the first seconds would just be a free head start.
 */
export const LIFELINE_MIN_ELAPSED_FRACTION = 0.5;

/**
 * A free_answer reveal, fully addressed. The server echoes back the tab and slot
 * it actually resolved against, so the page keys the badge on what was revealed
 * rather than on whichever tab the player happens to be viewing afterwards.
 */
export type RevealResult = {
	value: string;
	// `artist` only: the scorer's individual targets. The display string joins them
	// with ' & ', which is NOT re-splittable — a track whose artists[] is
	// ['D-Block & S-te-Fan'] joins to the same shape as one whose artists[] is
	// ['Rooler','Sefa']. The tag input needs the real list, so the server sends it.
	tags?: string[];
	field: string;
	tabId: string;
	slotIndex: number;
};

// ─── Powerup tiers + power_spin's roll ───────────────────────────────────────
//
// Tier is a power band, stored on the type row (powerup_types.tier, migration
// 0072) next to `category` and `holdable` because it is a fixed trait of the
// type, not a per-set dial. Nothing in the EARNING path reads it — planAwards
// builds its pool from coming_soon/enabled/category/score bounds and is
// untouched by tiers. Today its only reader is power_spin's roll pool.
export const POWERUP_TIERS = ['S', 'A', 'B', 'C', 'D'] as const;
export type PowerupTier = (typeof POWERUP_TIERS)[number];

// The tiers Power Spin draws from, best first. Order matters: it IS the fallback
// chain — an empty tier hands off to the next one (see rollSpinTier /
// pickSpinType in src/lib/server/powerups.ts).
export const SPIN_TIERS: readonly PowerupTier[] = ['S', 'A'];

/**
 * Types Power Spin must NEVER roll, because awarding them would award another
 * powerup and the spin could chain.
 *
 * `power_spin` itself is the obvious one — it is Tier A, so without this filter
 * the wheel could land on itself and loop. The list is a NAMED SET rather than a
 * single `!== 'power_spin'` check because the rule is broader than one id: ANY
 * type whose activation hands out a powerup belongs here, and the next such type
 * needs a place to register itself.
 *
 * No other type qualifies today. Every existing activation branch was checked
 * one by one: the ones that look like they give something away — give_a_shot,
 * penalty_shot, freeze, time_drain, tap_to_break — all write `team_effects`
 * rows, never `team_powerups`. materializeAward (src/lib/server/powerups.ts) is
 * the single spel-side writer of team_powerups, and power_spin will be its only
 * caller outside the earning ladder.
 *
 * With this filter the call chain is bounded at:
 *   materializeAward(power_spin)
 *     -> activatePowerup(power_spin)
 *       -> materializeAward(rolled)
 *         -> activatePowerup(rolled)   [only if the rolled type is immediate_use]
 *           -> terminates
 */
export const SPIN_EXCLUDED_TYPE_IDS = ['power_spin'] as const;

export function isSpinExcluded(id: string): boolean {
	return (SPIN_EXCLUDED_TYPE_IDS as readonly string[]).includes(id);
}

/**
 * How often the wheel reaches for Tier S. The per-set override lives at
 * powerup_config.types.power_spin.tier_s_chance (seeded by migration 0072) and is
 * resolved by resolveSpinTierSChance() — the same setting-not-constant shape as
 * lucky_dice's dice range and x_ray's reveal budget. This is only the fallback
 * for a set whose config predates the key.
 *
 * 0.15 = the designed 85% A / 15% S split.
 */
export const POWER_SPIN_DEFAULT_TIER_S_CHANCE = 0.15;

// ─── all_seeing_eye: the wire shape ──────────────────────────────────────────
//
// What the Eye is allowed to show, and nothing else. These three types ARE the
// security contract: the server builds exactly this and the client renders
// exactly this, so anything absent here cannot reach a browser.
//
// A stored submission carries two halves — what the team WROTE and what the
// scorer DECIDED. The written half is `field_values` (plus `fragments`, which is
// also player input: which fragment numbers they assigned). The decided half is
// `scored`, `total`, `breakdown` and `matched_source_track_id`, joined by the
// `submissions.status` column alongside. Every item in that second list answers
// "was this right?", which is the one question the Eye must never answer —
// reading other teams' answers WITHOUT being told which to trust is the whole
// mechanic. `matched_source_track_id` is the sharpest of them: it is the uuid of
// the correct track, straight off a join.
//
// stripAnswersForEye() (src/lib/server/powerups.ts) is built as an ALLOWLIST
// against these types rather than as a delete-list, so a field added to the
// submission shape later is excluded by default instead of silently riding along.
export type EyeSlot = {
	slotIndex: number;
	/** Only ever the team's own typed values. Never a score, never a verdict. */
	fieldValues: Record<string, string>;
	/** fragments variant only: which fragment numbers the team assigned. Input, not scoring. */
	fragments?: number[];
};

export type EyeTab = {
	tabPosition: number;
	slots: EyeSlot[];
};

export type EyeTeam = {
	teamId: string;
	displayName: string;
	color: string;
	tabs: EyeTab[];
	/**
	 * Present ONLY when powerup_config.types.all_seeing_eye.show_scores is exactly
	 * true. Left off entirely otherwise — not zeroed, not nulled — so a client that
	 * ignores the flag still cannot find a number to render.
	 */
	score?: number;
};

/** The whole payload one activation produces. */
export type AllSeeingEyeData = {
	challengeId: string;
	teams: EyeTeam[];
};

/** Default for the show-scores switch. False for the reason given on EyeTeam.score. */
export const EYE_DEFAULT_SHOW_SCORES = false;

// ─── resurrection: the short clock and the difference ────────────────────────
//
// Both numbers Resurrection turns on are computed HERE, client-safe and pure, for
// the same reason doubleDownMultiplier lives in this module: the player-facing
// modal must promise exactly what the server will do. The modal shows the retry
// length before the team commits, and the server sets the attempt's clock from
// the same function — a second copy of `/3` in a .svelte file is precisely the
// drift this module exists to prevent.

/** One third of the original clock — the whole cost of a second chance. */
export const RESURRECTION_TIMER_FRACTION = 1 / 3;

/**
 * The retry clock for a challenge whose normal timer is `timerSeconds`.
 *
 * Rounded, with a floor of 1 second: a 2-second challenge would otherwise round
 * to a 1-second retry and a 1-second challenge to a ZERO-second one — an attempt
 * that /api/auto-submit would close on its very first sweep, i.e. a Tier S
 * powerup spent on a clock that never ran.
 *
 * An untimed challenge (0 or null) has no clock to divide, so it returns null and
 * the retry inherits the untimed behaviour it already had: no deadline, no
 * auto-submit, the team submits when it submits.
 */
export function resurrectionRetrySeconds(timerSeconds: number | null | undefined): number | null {
	if (typeof timerSeconds !== 'number' || !Number.isFinite(timerSeconds) || timerSeconds <= 0) {
		return null;
	}
	return Math.max(1, Math.round(timerSeconds * RESURRECTION_TIMER_FRACTION));
}

/**
 * What a retry does to the team's score: the DIFFERENCE, never a rollback.
 *
 * `oldFinal` is the breakdown.final of the submission being replaced — the exact
 * number that submission added to teams.score, multipliers and bonuses included.
 * `newFinal` is the same quantity for the retry. The result is added to the team
 * score in ONE update, so the old points are never briefly removed and never
 * left standing alongside the new ones.
 *
 *   replace   newFinal - oldFinal      40 → 60 = +20    60 → 40 = -20
 *   best      MAX(0, that)             40 → 60 = +20    60 → 40 =  +0
 *
 * Pure and exported so the arithmetic can be asserted directly
 * (tests/bots/verify-resurrection.ts) rather than inferred from a live game.
 */
export function resurrectionDelta(
	oldFinal: number,
	newFinal: number,
	mode: ResurrectionScoreMode
): number {
	const diff = newFinal - oldFinal;
	return mode === 'best' ? Math.max(0, diff) : diff;
}
