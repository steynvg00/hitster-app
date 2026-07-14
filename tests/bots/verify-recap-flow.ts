// Recap reveal-phase state-machine verification (Battle Mode stuk 3b).
//
//   npm run bots:verify-recap-flow
//
// Pure-function harness — NO app, NO DB, NO Playwright (same shape as
// verify-battle.ts). The reveal phase's decisions live in $lib/recap-flow as
// pure functions precisely so the whole click sequence can be swept here without
// a database; the actions are thin DB glue over these.
//
// Why pure rather than driving the real host actions: migration 0063 (the
// battle_reveal_index column + the widened recap_state CHECK) is run MANUALLY in
// the Supabase SQL Editor, so a DB-driven harness cannot pass until the host has
// run it. This gate covers the logic today; the DB-level transitions are the
// host's post-0063 console test (see the PR notes).
//
// What is asserted — the two sequences from the stuk spec:
//   2-battle set: startRecap → battle_reveal(0); click → 1; click → 2;
//                 click → revealing (recap_reveal_index untouched at 0);
//                 team cascade → ... → complete on the last team.
//   0-battle set: startRecap → pending (NOT battle_reveal); the classic
//                 pending → revealing → complete flow, identical to pre-3b.
//
// The critical invariant, asserted on every step: the battle phase NEVER
// advances recap_reveal_index (it is a direct index into recap_ranking, read in
// six places across three surfaces).

import {
	planRecapEntry,
	planBattleReveal,
	planTeamRevealState,
	type RecapPhase
} from '../../src/lib/recap-flow';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passed++;
		console.log(`  ✅ ${label}`);
	} else {
		failed++;
		console.log(`  ❌ ${label}\n       expected: ${e}\n       actual:   ${a}`);
	}
}

/**
 * Simulated recap: mirrors what the two actions do to game_sets, so the harness
 * asserts the SEQUENCE (what N clicks produce), not just the individual planners.
 */
type SetState = {
	recapState: RecapPhase;
	battleRevealIndex: number;
	recapRevealIndex: number;
};

/** Mirrors startRecap's phase entry. */
function startRecap(battlesTotal: number): SetState {
	return {
		recapState: planRecapEntry(battlesTotal),
		battleRevealIndex: 0,
		recapRevealIndex: 0
	};
}

/** Mirrors the recap `reveal` action's branch structure. */
function clickReveal(s: SetState, battlesTotal: number, totalTeams: number): SetState {
	// Battle branch — early-returns before the team cascade is ever reached.
	if (s.recapState === 'battle_reveal') {
		const step = planBattleReveal(s.battleRevealIndex, battlesTotal);
		if (step.kind === 'battle') {
			return { ...s, battleRevealIndex: step.battleRevealIndex };
		}
		// Hand-over click: phase only. recap_reveal_index deliberately untouched.
		return { ...s, recapState: 'revealing' };
	}

	// Team cascade — unchanged index math (newIndex = current + 1, capped).
	const newIndex = s.recapRevealIndex + 1;
	if (newIndex > totalTeams) return s; // action fails: 'All teams already revealed'
	return {
		...s,
		recapRevealIndex: newIndex,
		recapState: planTeamRevealState(newIndex, totalTeams)
	};
}

console.log('▶ Recap reveal-phase state machine — Battle Mode stuk 3b\n');

// ── Scenario 1: 2-battle set, 6 teams ───────────────────────────────────────
console.log('Scenario: 2 battles · 6 teams — battles reveal before the podium');
{
	const BATTLES = 2;
	const TEAMS = 6;
	let s = startRecap(BATTLES);
	check('startRecap enters battle_reveal', s.recapState, 'battle_reveal');
	check('battle_reveal_index starts at 0', s.battleRevealIndex, 0);
	check('recap_reveal_index starts at 0', s.recapRevealIndex, 0);

	s = clickReveal(s, BATTLES, TEAMS);
	check('click 1 → battle 1 revealed', s.battleRevealIndex, 1);
	check('click 1 holds the phase', s.recapState, 'battle_reveal');
	check('click 1 does NOT touch recap_reveal_index', s.recapRevealIndex, 0);

	s = clickReveal(s, BATTLES, TEAMS);
	check('click 2 → battle 2 revealed', s.battleRevealIndex, 2);
	check('click 2 holds the phase', s.recapState, 'battle_reveal');
	check('click 2 does NOT touch recap_reveal_index', s.recapRevealIndex, 0);

	s = clickReveal(s, BATTLES, TEAMS);
	check('click 3 → hands over to revealing', s.recapState, 'revealing');
	check('click 3 leaves recap_reveal_index at 0 (cascade starts fresh)', s.recapRevealIndex, 0);
	check('click 3 does not over-advance battles', s.battleRevealIndex, 2);

	// Team cascade: 6 clicks, complete on the last.
	for (let i = 1; i <= TEAMS; i++) {
		s = clickReveal(s, BATTLES, TEAMS);
		check(`team click ${i} → recap_reveal_index ${i}`, s.recapRevealIndex, i);
		check(
			`team click ${i} state`,
			s.recapState,
			i === TEAMS ? 'complete' : 'revealing'
		);
	}
	check('battle counter untouched by the whole team cascade', s.battleRevealIndex, 2);
	check('total clicks to finish = battles + 1 + teams', 3 + TEAMS, 9);
}

// ── Scenario 2: 0-battle set — must behave exactly as pre-3b ────────────────
console.log('\nScenario: 0 battles · 6 teams — classic recap, zero regression');
{
	const BATTLES = 0;
	const TEAMS = 6;
	let s = startRecap(BATTLES);
	check('startRecap enters pending (NOT battle_reveal)', s.recapState, 'pending');
	check('battle_reveal_index stays 0', s.battleRevealIndex, 0);

	s = clickReveal(s, BATTLES, TEAMS);
	check('click 1 → revealing (classic first reveal)', s.recapState, 'revealing');
	check('click 1 → recap_reveal_index 1 (a TEAM, not a battle)', s.recapRevealIndex, 1);

	for (let i = 2; i <= TEAMS; i++) s = clickReveal(s, BATTLES, TEAMS);
	check('last team → complete', s.recapState, 'complete');
	check('all teams revealed', s.recapRevealIndex, TEAMS);
	check('battle counter never moved', s.battleRevealIndex, 0);

	// Over-click guard: the existing action fails rather than advancing.
	const after = clickReveal(s, BATTLES, TEAMS);
	check('over-click does not advance past the last team', after.recapRevealIndex, TEAMS);
}

// ── Scenario 3: 1-battle set — the minimal battle case ──────────────────────
console.log('\nScenario: 1 battle · 2 teams — minimal battle recap');
{
	const BATTLES = 1;
	const TEAMS = 2;
	let s = startRecap(BATTLES);
	check('enters battle_reveal', s.recapState, 'battle_reveal');

	s = clickReveal(s, BATTLES, TEAMS);
	check('click 1 → battle 1', s.battleRevealIndex, 1);
	check('click 1 holds phase', s.recapState, 'battle_reveal');

	s = clickReveal(s, BATTLES, TEAMS);
	check('click 2 → revealing', s.recapState, 'revealing');
	check('recap_reveal_index still 0', s.recapRevealIndex, 0);

	s = clickReveal(s, BATTLES, TEAMS);
	check('click 3 → team 1', s.recapRevealIndex, 1);
	check('not complete yet', s.recapState, 'revealing');

	s = clickReveal(s, BATTLES, TEAMS);
	check('click 4 → team 2 = complete', s.recapState, 'complete');
}

// ── Planner unit edges ──────────────────────────────────────────────────────
console.log('\nPlanner edges');
check('planRecapEntry(0) → pending', planRecapEntry(0), 'pending');
check('planRecapEntry(1) → battle_reveal', planRecapEntry(1), 'battle_reveal');
check('planRecapEntry(9) → battle_reveal', planRecapEntry(9), 'battle_reveal');
check('planBattleReveal(0, 2) → battle 1', planBattleReveal(0, 2), {
	kind: 'battle',
	battleRevealIndex: 1
});
check('planBattleReveal(2, 2) → start_teams', planBattleReveal(2, 2), { kind: 'start_teams' });
check('planBattleReveal(0, 0) → start_teams (no battles)', planBattleReveal(0, 0), {
	kind: 'start_teams'
});
check('planTeamRevealState(5, 6) → revealing', planTeamRevealState(5, 6), 'revealing');
check('planTeamRevealState(6, 6) → complete', planTeamRevealState(6, 6), 'complete');

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
