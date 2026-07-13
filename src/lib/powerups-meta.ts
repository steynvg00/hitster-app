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
