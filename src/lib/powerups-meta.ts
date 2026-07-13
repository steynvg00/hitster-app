// Client-safe powerup metadata shared between the server activation code
// (src/lib/server/powerups.ts) and the player-facing Svelte modals. Kept in its
// own module with NO server-only imports so `.svelte` files can import it too.

// Powerups that act on ANOTHER team and therefore require a target picker at
// activation. give_a_shot is live as of stuk 1; freeze / time_drain /
// tap_to_break are wired here (the picker renders for them) but their
// powerup_types rows stay coming_soon until stuks 2-3.
export const TARGETED_POWERUP_IDS = [
	'give_a_shot',
	'freeze',
	'time_drain',
	'tap_to_break'
] as const;

export function isTargetedPowerup(id: string): boolean {
	return (TARGETED_POWERUP_IDS as readonly string[]).includes(id);
}

// Timer attacks — the subset of targeted powerups that need the target to be IN
// a live timed challenge right now (design B: no apply-on-next-challenge). The
// target picker greys teams without an active timed attempt for these; the
// server (resolveTargetTimedAttempt) enforces the same rule as a safety net.
// give_a_shot / tap_to_break stay valid against any team, so they're excluded.
export const TIMER_POWERUP_IDS = ['freeze', 'time_drain'] as const;

export function isTimerPowerup(id: string): boolean {
	return (TIMER_POWERUP_IDS as readonly string[]).includes(id);
}
