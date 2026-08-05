// Client-safe powerup metadata shared between the server activation code
// (src/lib/server/powerups.ts) and the player-facing Svelte modals. Kept in its
// own module with NO server-only imports so `.svelte` files can import it too.

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
	const g = Math.min(
		DOUBLE_DOWN_MAX_PCT,
		Math.max(DOUBLE_DOWN_MIN_PCT, Math.round(predictedPct))
	);
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
// x_ray reveals SEVERAL answers from one activation. It is not a second reveal
// mechanism: every single reveal it produces is one (tab, slot, field) triple
// resolved by the same server helper free_answer uses (resolveFreeAnswerValue),
// stored as the same team_effects row, keyed by the same freeAnswerRevealKey, and
// pre-filled by the same applyRevealToDraft. The only difference is how many
// addresses go in — one, or up to five.
export const REVEAL_POWERUP_IDS = ['free_answer', 'x_ray'] as const;

export function isRevealPowerup(id: string): boolean {
	return (REVEAL_POWERUP_IDS as readonly string[]).includes(id);
}

/** x_ray: how many answer cells a team may pick in one activation. */
export const X_RAY_MAX_REVEALS = 5;

/** One requested reveal, as posted by the activation modal. */
export type RevealTarget = {
	tabId?: string;
	slotIndex: number;
	field: string;
};

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
