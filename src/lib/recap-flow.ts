// Recap reveal-phase state machine (Battle Mode stuk 3b) — PURE, client-safe,
// no DB and no server imports, so the harness (tests/bots/verify-recap-flow.ts)
// can exercise every transition standalone. Same split as $lib/battle-ranking:
// the arithmetic/decisions live here, the DB glue stays in the actions.
//
// Phase order:  pending → battle_reveal → revealing → complete
//                  └──────────────────────┘
//         (battle_reveal is skipped entirely when a set has no resolved battles,
//          so a non-battle recap runs pending → revealing → complete exactly as
//          it did before this stuk)
//
// TWO COUNTERS, deliberately separate:
//   game_sets.recap_reveal_index  — "teams revealed". Indexed straight into
//     recap_ranking in six places across three surfaces (host recap, TV podium,
//     player waiting). The battle reveal must never consume or perturb it.
//   game_sets.battle_reveal_index — "battles revealed". This stuk's counter.

export type RecapPhase = 'pending' | 'battle_reveal' | 'revealing' | 'complete';

/**
 * The recap_state a set opens on, decided at startRecap.
 *
 * A set with ≥1 resolved battle (battle_ranking IS NOT NULL) opens on the battle
 * reveal. Every other set keeps the historical 'pending' entry — the first
 * "Reveal next" click then flips it to 'revealing' via the untouched team
 * cascade, byte-for-byte as before this stuk.
 */
export function planRecapEntry(revealableBattles: number): 'pending' | 'battle_reveal' {
	return revealableBattles > 0 ? 'battle_reveal' : 'pending';
}

export type BattleRevealStep =
	/** Show battle #battleRevealIndex (1-based count); stay in battle_reveal. */
	| { kind: 'battle'; battleRevealIndex: number }
	/** All battles shown — hand over to the team cascade (recap_state='revealing'). */
	| { kind: 'start_teams' };

/**
 * What a "Reveal next" click does while in the battle_reveal phase.
 *
 * With M battles the host clicks M+1 times: M reveals, then one hand-over click
 * that starts the team cascade. The hand-over is its own click on purpose — it
 * gives the room a beat between the last battle and the podium, and it keeps
 * recap_reveal_index untouched at 0 so the cascade starts where it always did.
 */
export function planBattleReveal(battleRevealIndex: number, battlesTotal: number): BattleRevealStep {
	const next = battleRevealIndex + 1;
	return next <= battlesTotal ? { kind: 'battle', battleRevealIndex: next } : { kind: 'start_teams' };
}

/**
 * The recap_state that accompanies a team reveal — 'complete' on the last team.
 *
 * 'complete' has been a legal recap_state since 0020 and the player surfaces
 * already read it (play/waiting and the team page redirect to thanks on it), but
 * until this stuk NOTHING ever wrote it: players sat on the waiting screen after
 * the final reveal until the host hit End & Reset. This makes the dead state real.
 *
 * Takes the ALREADY-COMPUTED next index — the caller's index arithmetic is not
 * this function's business, so the six recap_reveal_index sites stay untouched.
 */
export function planTeamRevealState(nextRevealIndex: number, totalTeams: number): RecapPhase {
	return nextRevealIndex >= totalTeams ? 'complete' : 'revealing';
}
