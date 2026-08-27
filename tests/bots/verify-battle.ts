// Battle Mode ranking-engine verification.
//
//   npm run bots:verify-battle
//
// Pure-function harness — NO app, NO DB, NO Playwright. Dit is de GATE voor de
// ranglijst-rekenkunde: de ladderafleiding uit max_points + team_count, aflopend
// op score, gedeelde plek bij gelijke score, competition numbering (het volgende
// blok slaat verbruikte plekken over), en de bonus die daaruit volgt.
//
// Ladder-model: de ladder wordt NIET opgeslagen — hij volgt bij resolutie uit
// één max_points-waarde + het échte team_count van de set (lineair max→0 in
// gelijke stappen, laatste PLEK altijd 0). computeBattleRanking krijgt die
// ladder als array binnen; de scenario's hieronder bouwen hem via
// deriveLadder(maxPoints, teamCount) in plaats van hem met de hand te schrijven,
// zodat een regressie in de afleiding hier óók omvalt.
//
// Gedeelde plek: een gelijk blok krijgt de bonus van de HOOGSTE plek die het
// bezet — twee teams gelijk aan kop krijgen allebei de topbonus. (Niet het
// gemiddelde van de bezette plekken: dat strafte een gedeelde eerste plaats af.)
//
// Het DB-gedrag — CAS-idempotentie (twee keer resolven schrijft de bonus één
// keer) en "de kroon beweegt niet van een battle" — zit in
// verify-battle-integration.ts, niet hier.

import { computeBattleRanking, deriveLadder, type BattleEntry } from '../../src/lib/battle-ranking';

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass
			? `${JSON.stringify(got)}`
			: `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
	});
}

const rankOf = (r: ReturnType<typeof computeBattleRanking>, id: string) =>
	r.find((e) => e.team_id === id)?.rank ?? -1;
const scoreOf = (r: ReturnType<typeof computeBattleRanking>, id: string) =>
	r.find((e) => e.team_id === id)?.score ?? -1;
const awardOf = (r: ReturnType<typeof computeBattleRanking>, id: string) =>
	r.find((e) => e.team_id === id)?.awarded ?? -1;

// ── 0: deriveLadder ──────────────────────────────────────────────────────────
{
	assert('0 M=10 N=6 → [10,8,6,4,2,0]', deriveLadder(10, 6), [10, 8, 6, 4, 2, 0]);
	assert('0 M=10 N=4 → [10,7,3,0] (6.67→7, 3.33→3)', deriveLadder(10, 4), [10, 7, 3, 0]);
	assert('0 M=10 N=2 → [max,0]', deriveLadder(10, 2), [10, 0]);
	assert('0 N=1 → [0] (geen deling door nul)', deriveLadder(10, 1), [0]);
	assert('0 laatste plek is altijd 0', deriveLadder(37, 5).at(-1), 0);
}

// ── 1: zes verschillende scores → plek 1..6, ladder 1-op-1 ───────────────────
{
	const L6 = deriveLadder(10, 6); // [10,8,6,4,2,0]
	const e: BattleEntry[] = [
		{ teamId: 'A', score: 30 },
		{ teamId: 'B', score: 25 },
		{ teamId: 'C', score: 20 },
		{ teamId: 'D', score: 15 },
		{ teamId: 'E', score: 10 },
		{ teamId: 'F', score: 5 }
	];
	const r = computeBattleRanking(e, L6);
	assert(
		'1 volgorde is score-aflopend',
		r.map((x) => x.team_id),
		['A', 'B', 'C', 'D', 'E', 'F']
	);
	assert(
		'1 plekken 1..6',
		r.map((x) => x.rank),
		[1, 2, 3, 4, 5, 6]
	);
	assert('1 challengescore reist mee', scoreOf(r, 'C'), 20);
	assert(
		'1 bonus volgt de ladder',
		r.map((x) => x.awarded),
		[10, 8, 6, 4, 2, 0]
	);
	assert('1 het LAATSTE team krijgt niets', awardOf(r, 'F'), 0);
	// De kern van de weergave: score en bonus zijn twee losse getallen.
	assert('1 score en bonus staan los van elkaar', [scoreOf(r, 'A'), awardOf(r, 'A')], [30, 10]);
}

// ── 2: invoervolgorde doet er niet toe ───────────────────────────────────────
{
	const L3 = deriveLadder(10, 3); // [10,5,0]
	const e: BattleEntry[] = [
		{ teamId: 'F', score: 5 },
		{ teamId: 'C', score: 20 },
		{ teamId: 'A', score: 30 }
	];
	const r = computeBattleRanking(e, L3);
	assert(
		'2 gesorteerd ongeacht invoervolgorde',
		r.map((x) => x.team_id),
		['A', 'C', 'F']
	);
	assert(
		'2 bonus volgt de plek, niet de invoer',
		r.map((x) => x.awarded),
		[10, 5, 0]
	);
}

// ── 3: gelijkspel aan kop → gedeelde 1e plaats, BEIDE de topbonus ────────────
{
	const L3 = deriveLadder(10, 3); // [10,5,0]
	const e: BattleEntry[] = [
		{ teamId: 'A', score: 30 },
		{ teamId: 'B', score: 30 },
		{ teamId: 'C', score: 12 }
	];
	const r = computeBattleRanking(e, L3);
	assert('3 A deelt plek 1', rankOf(r, 'A'), 1);
	assert('3 B deelt plek 1', rankOf(r, 'B'), 1);
	assert('3 beide winnaars krijgen de HOOGSTE bonus', [awardOf(r, 'A'), awardOf(r, 'B')], [10, 10]);
	assert('3 C krijgt plek 3, niet 2 (competition numbering)', rankOf(r, 'C'), 3);
	assert('3 C krijgt de bonus van plek 3', awardOf(r, 'C'), 0);
}

// ── 4: gelijk blok in het midden ─────────────────────────────────────────────
{
	const L5 = deriveLadder(10, 5); // [10,8,5,3,0]
	const e: BattleEntry[] = [
		{ teamId: 'A', score: 30 },
		{ teamId: 'B', score: 20 },
		{ teamId: 'C', score: 20 },
		{ teamId: 'D', score: 20 },
		{ teamId: 'E', score: 5 }
	];
	const r = computeBattleRanking(e, L5);
	assert('4 A plek 1 → 10', [rankOf(r, 'A'), awardOf(r, 'A')], [1, 10]);
	assert('4 B/C/D delen plek 2', [rankOf(r, 'B'), rankOf(r, 'C'), rankOf(r, 'D')], [2, 2, 2]);
	assert(
		'4 het hele blok krijgt de bonus van plek 2',
		[awardOf(r, 'B'), awardOf(r, 'C'), awardOf(r, 'D')],
		[8, 8, 8]
	);
	assert('4 E krijgt plek 5 → 0', [rankOf(r, 'E'), awardOf(r, 'E')], [5, 0]);
}

// ── 5: alle teams gelijk → iedereen plek 1 en de topbonus ────────────────────
{
	const L3 = deriveLadder(10, 3);
	const e: BattleEntry[] = [
		{ teamId: 'A', score: 0 },
		{ teamId: 'B', score: 0 },
		{ teamId: 'C', score: 0 }
	];
	const r = computeBattleRanking(e, L3);
	assert(
		'5 alles gelijk → alle plekken 1',
		r.map((x) => x.rank),
		[1, 1, 1]
	);
	// Gevolg van "een blok krijgt de bonus van zijn hoogste plek": bij één groot
	// gelijk blok krijgt niemand de nul. De regel geldt per PLEK, niet per team.
	assert(
		'5 alles gelijk → iedereen de topbonus',
		r.map((x) => x.awarded),
		[10, 10, 10]
	);
}

// ── 6: wie niets inleverde staat er met 0 en dus onderaan ────────────────────
{
	const L3 = deriveLadder(10, 3); // [10,5,0]
	const e: BattleEntry[] = [
		{ teamId: 'A', score: 14 },
		{ teamId: 'B', score: 0 },
		{ teamId: 'C', score: 3 }
	];
	const r = computeBattleRanking(e, L3);
	assert(
		'6 nul-team onderaan, wel in de lijst',
		r.map((x) => x.team_id),
		['A', 'C', 'B']
	);
	assert('6 lengte = aantal teams', r.length, 3);
	assert('6 nul-team krijgt ook geen bonus', awardOf(r, 'B'), 0);
}

// ── 7: randgevallen ──────────────────────────────────────────────────────────
{
	assert('7 lege invoer → lege ranglijst', computeBattleRanking([], deriveLadder(10, 6)), []);
	const solo = computeBattleRanking([{ teamId: 'A', score: 7 }], deriveLadder(10, 1));
	assert('7 één team → plek 1, geen bonus', solo, [
		{ team_id: 'A', rank: 1, score: 7, awarded: 0 }
	]);
	// Een negatieve challenge-score kan uit een penalty komen; die hoort gewoon
	// onderaan te sorteren en niet als "geen inzending" te lezen.
	const neg = computeBattleRanking(
		[
			{ teamId: 'A', score: 0 },
			{ teamId: 'B', score: -4 }
		],
		deriveLadder(10, 2)
	);
	assert(
		'7 negatieve score sorteert onder 0',
		neg.map((x) => x.team_id),
		['A', 'B']
	);
	assert(
		'7 max_points 0 → nergens bonus',
		computeBattleRanking(
			[
				{ teamId: 'A', score: 9 },
				{ teamId: 'B', score: 1 }
			],
			deriveLadder(0, 2)
		).map((x) => x.awarded),
		[0, 0]
	);
}

// ── 8: ladder korter dan het veld → overtollige plekken krijgen 0 ────────────
// Structurele robuustheid van computeBattleRanking zelf — GEEN geval dat via de
// echte configweg kan ontstaan (deriveLadder levert altijd precies teamCount
// waarden). Blijft staan als vangnet op de overflow-afhandeling.
{
	const shortLadder = [10, 5];
	const e: BattleEntry[] = [
		{ teamId: 'A', score: 20 },
		{ teamId: 'B', score: 15 },
		{ teamId: 'C', score: 10 },
		{ teamId: 'D', score: 5 }
	];
	const r = computeBattleRanking(e, shortLadder);
	assert(
		'8 overflow-plekken krijgen 0',
		r.map((x) => x.awarded),
		[10, 5, 0, 0]
	);
}

// ── report ────────────────────────────────────────────────────────────────────
console.log('─── Battle Mode ranglijst-engine ───');
for (const c of checks) {
	console.log(`  ${c.pass ? '✅' : '❌'} ${c.name.padEnd(50)} ${c.pass ? '' : c.detail}`);
}
const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
console.log(
	'\n(DB-integratie: CAS-idempotentie + "de kroon beweegt niet" — verify-battle-integration.)'
);
if (passed !== checks.length) process.exit(1);
