// Comeback op de stand bij aanvang van de ronde — verificatie.
//
//   npm run bots:verify-comeback-round-start
//
// Pure harness, geen DB. Pint de eigenschap waar de fix om draait:
// DE UITSLAG MAG NIET AFHANGEN VAN DE VOLGORDE VAN INLEVEREN.
//
// Wat er mis was: computeBreakdown kreeg `team_score` en `leader_score` "zoals
// ze nu zijn". Beide bewegen tijdens een ronde, want elke score springt op het
// moment van inleveren. Dus werd een team dat de ronde nog moest spelen
// vergeleken met een team dat hem al gespeeld had — en op challenge 1 kreeg
// IEDEREEN behalve het snelste team x1,5, omdat de leider toen al > 0 stond en
// zijzelf nog op 0.
//
// standingsAtRoundStart haalt van elk team de score van DEZE challenge er weer
// af, zodat iedereen op dezelfde stand wordt afgerekend.
//
// De scenario's hieronder draaien de echte computeBreakdown; alleen de twee
// scores worden op de twee manieren aangeleverd (live vs. round-start).

import {
	computeBreakdown,
	standingsAtRoundStart,
	type BonusParams
} from '../../src/lib/server/scoring';

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass ? JSON.stringify(got) : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
	});
}
function assertTrue(name: string, cond: boolean, detail: string) {
	checks.push({ name, pass: cond, detail });
}

const baseParams: Omit<BonusParams, 'team_score' | 'leader_score'> = {
	difficulty_rating: 3,
	challenge_multiplier: 1,
	current_streak: 0,
	streak_thresholds: [],
	elapsed_seconds: null,
	speed_threshold_seconds: null
};

const comebackOf = (teamScore: number, leaderScore: number, base = 100) =>
	computeBreakdown(base, { ...baseParams, team_score: teamScore, leader_score: leaderScore })
		.comeback_multiplier;

// ─── 1. De pure herrekening ──────────────────────────────────────────────────

{
	const standings = [
		{ id: 'A', score: 800 },
		{ id: 'B', score: 300 },
		{ id: 'C', score: 250 }
	];
	// A heeft deze challenge al gespeeld en scoorde 400; B en C nog niet.
	const scored = new Map([['A', 400]]);
	assert(
		'round-start trekt alleen de score van DEZE challenge af',
		standingsAtRoundStart(standings, scored),
		[
			{ id: 'A', score: 400 },
			{ id: 'B', score: 300 },
			{ id: 'C', score: 250 }
		]
	);
}

{
	assert(
		'geen inzendingen → stand ongewijzigd',
		standingsAtRoundStart([{ id: 'A', score: 120 }], new Map()),
		[{ id: 'A', score: 120 }]
	);
}

{
	// Een handmatige correctie omlaag door de host zou het verschil negatief
	// kunnen maken; een negatieve leider zou het hele veld een comeback geven.
	assert('nooit onder nul', standingsAtRoundStart([{ id: 'A', score: 10 }], new Map([['A', 50]])), [
		{ id: 'A', score: 0 }
	]);
}

// ─── 2. Challenge 1: niemand ligt achter ─────────────────────────────────────

{
	// Vijf teams op 0. A levert als eerste in en scoort 120.
	const standings = [
		{ id: 'A', score: 120 },
		{ id: 'B', score: 0 },
		{ id: 'C', score: 0 }
	];
	const scored = new Map([['A', 120]]);
	const rs = standingsAtRoundStart(standings, scored);
	const leader = rs.reduce((m, t) => Math.max(m, t.score), 0);

	assert('challenge 1: round-start leider is 0', leader, 0);
	assert('challenge 1 NA fix: B krijgt geen comeback', comebackOf(0, leader), 1.0);

	// Ter contrast: precies wat er vóór de fix gebeurde.
	const liveLeader = standings.reduce((m, t) => Math.max(m, t.score), 0);
	assert('challenge 1 VÓÓR fix: B kreeg wel x1,5', comebackOf(0, liveLeader), 1.5);
}

// ─── 3. Volgorde-onafhankelijkheid — de kerneigenschap ───────────────────────
//
// Het tegenvoorbeeld uit de docstring van standingsAtRoundStart, dat de
// "vergelijk ná inlevering"-variant NIET oplost:
//   A: 400 vooraf, scoort 400.   B: 250 vooraf, scoort 30.

{
	const before = { A: 400, B: 250 };
	const scores = { A: 400, B: 30 };

	// Volgorde 1: A eerst, dan B.
	const afterA = [
		{ id: 'A', score: before.A + scores.A },
		{ id: 'B', score: before.B }
	];
	const bAfterA = standingsAtRoundStart(afterA, new Map([['A', scores.A]]));
	const leaderBAfterA = bAfterA.reduce((m, t) => Math.max(m, t.score), 0);
	const cbBAfterA = comebackOf(bAfterA.find((t) => t.id === 'B')!.score, leaderBAfterA);

	// Volgorde 2: B eerst, dan A.
	const beforeAnyone = [
		{ id: 'A', score: before.A },
		{ id: 'B', score: before.B }
	];
	const bFirst = standingsAtRoundStart(beforeAnyone, new Map());
	const leaderBFirst = bFirst.reduce((m, t) => Math.max(m, t.score), 0);
	const cbBFirst = comebackOf(bFirst.find((t) => t.id === 'B')!.score, leaderBFirst);

	assert('B krijgt dezelfde comeback, ongeacht de volgorde', cbBAfterA, cbBFirst);
	assert('en dat is in dit geval geen comeback', cbBAfterA, 1.0);

	// Zonder de fix zou dezelfde B wél verschillen.
	const liveAfterA = comebackOf(
		before.B,
		afterA.reduce((m, t) => Math.max(m, t.score), 0)
	);
	const liveBFirst = comebackOf(
		before.B,
		beforeAnyone.reduce((m, t) => Math.max(m, t.score), 0)
	);
	assertTrue(
		'VÓÓR fix hing dezelfde B wél van de volgorde af',
		liveAfterA !== liveBFirst,
		`na A: x${liveAfterA}, vóór A: x${liveBFirst}`
	);
}

// ─── 4. Een team dat echt achterligt, houdt zijn comeback ────────────────────

{
	// A staat op 1000 na vier challenges, B op 200. Beiden spelen challenge 5.
	const standings = [
		{ id: 'A', score: 1000 },
		{ id: 'B', score: 200 }
	];
	const rs = standingsAtRoundStart(standings, new Map());
	const leader = rs.reduce((m, t) => Math.max(m, t.score), 0);
	assert('echt achterliggend team krijgt nog steeds x1,5', comebackOf(200, leader), 1.5);
	assert('de leider zelf niet', comebackOf(1000, leader), 1.0);
	// En ook nadat A al ingeleverd heeft, blijft B's antwoord hetzelfde.
	const afterA = standingsAtRoundStart(
		[
			{ id: 'A', score: 1300 },
			{ id: 'B', score: 200 }
		],
		new Map([['A', 300]])
	);
	assert(
		'…en dat verandert niet als de leider al ingeleverd heeft',
		comebackOf(
			200,
			afterA.reduce((m, t) => Math.max(m, t.score), 0)
		),
		1.5
	);
}

// ─── 5. Resurrection: de oude score telt niet dubbel ─────────────────────────

{
	// B speelde challenge 3 en scoorde 40; teams.score bevat die 40. Bij de retry
	// moet B tegen dezelfde stand-bij-aanvang worden afgerekend als de eerste keer.
	const firstAttempt = standingsAtRoundStart(
		[
			{ id: 'A', score: 900 },
			{ id: 'B', score: 260 }
		],
		new Map()
	);
	const retry = standingsAtRoundStart(
		[
			{ id: 'A', score: 900 },
			{ id: 'B', score: 300 } // 260 + de 40 van de eerste poging
		],
		new Map([['B', 40]])
	);
	assert('retry meet op dezelfde stand als de eerste poging', retry, firstAttempt);
}

// ─── 6. De guards van computeBreakdown blijven staan ─────────────────────────

{
	assert('base 0 → geen comeback', comebackOf(0, 1000, 0), 1.0);
	assert('leider 0 → geen comeback', comebackOf(0, 0), 1.0);
	assert('precies op de helft is geen comeback (strikt <)', comebackOf(500, 1000), 1.0);
	assert('net eronder wel', comebackOf(499, 1000), 1.5);
}

// ─── Rapport ─────────────────────────────────────────────────────────────────
let failed = 0;
for (const c of checks) {
	if (!c.pass) failed++;
	console.log(`${c.pass ? '✅' : '❌'} ${c.name} — ${c.detail}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
