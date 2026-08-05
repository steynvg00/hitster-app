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

/**
 * A free_answer reveal, fully addressed. The server echoes back the tab and slot
 * it actually resolved against, so the page keys the badge on what was revealed
 * rather than on whichever tab the player happens to be viewing afterwards.
 */
export type RevealResult = {
	value: string;
	field: string;
	tabId: string;
	slotIndex: number;
};
