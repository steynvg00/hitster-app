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
