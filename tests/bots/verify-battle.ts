// Battle Mode ranking-engine verification.
//
//   npm run bots:verify-battle
//
// Pure-function harness — NO app, NO DB, NO Playwright. Dit is de GATE voor de
// ranglijst-rekenkunde: aflopend op score, gedeelde plek bij gelijke score,
// competition numbering (het volgende blok slaat verbruikte plekken over), en
// de plaatsing van teams die niets inleverden.
//
// Een battle deelt GEEN punten uit. Er is dus geen ladder, geen awarded en geen
// tijd-tiebreak meer: het team met de meeste punten op die challenge wint, en
// bij gelijke stand is de plek gedeeld.
//
// Het DB-gedrag — CAS-idempotentie (twee keer resolven schrijft één keer) en
// "resolutie raakt geen enkele score aan" — is structureel (de CAS-claim, en
// resolveBattle doet simpelweg geen score-update meer) en wordt live
// meegenomen, niet hier geassert.

import { computeBattleRanking, type BattleEntry } from '../../src/lib/battle-ranking';

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

// ── 1: zes verschillende scores → plek 1..6 in volgorde ──────────────────────
{
	const e: BattleEntry[] = [
		{ teamId: 'A', score: 30 },
		{ teamId: 'B', score: 25 },
		{ teamId: 'C', score: 20 },
		{ teamId: 'D', score: 15 },
		{ teamId: 'E', score: 10 },
		{ teamId: 'F', score: 5 }
	];
	const r = computeBattleRanking(e);
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
	assert('1 score reist mee', scoreOf(r, 'C'), 20);
}

// ── 2: invoervolgorde doet er niet toe ───────────────────────────────────────
{
	const e: BattleEntry[] = [
		{ teamId: 'F', score: 5 },
		{ teamId: 'C', score: 20 },
		{ teamId: 'A', score: 30 }
	];
	const r = computeBattleRanking(e);
	assert(
		'2 gesorteerd ongeacht invoervolgorde',
		r.map((x) => x.team_id),
		['A', 'C', 'F']
	);
}

// ── 3: gelijkspel aan kop → GEDEELDE eerste plaats ───────────────────────────
{
	const e: BattleEntry[] = [
		{ teamId: 'A', score: 30 },
		{ teamId: 'B', score: 30 },
		{ teamId: 'C', score: 12 }
	];
	const r = computeBattleRanking(e);
	assert('3 A deelt plek 1', rankOf(r, 'A'), 1);
	assert('3 B deelt plek 1', rankOf(r, 'B'), 1);
	assert('3 C krijgt plek 3, niet 2 (competition numbering)', rankOf(r, 'C'), 3);
}

// ── 4: gelijk blok in het midden ─────────────────────────────────────────────
{
	const e: BattleEntry[] = [
		{ teamId: 'A', score: 30 },
		{ teamId: 'B', score: 20 },
		{ teamId: 'C', score: 20 },
		{ teamId: 'D', score: 20 },
		{ teamId: 'E', score: 5 }
	];
	const r = computeBattleRanking(e);
	assert('4 A plek 1', rankOf(r, 'A'), 1);
	assert('4 B/C/D delen plek 2', [rankOf(r, 'B'), rankOf(r, 'C'), rankOf(r, 'D')], [2, 2, 2]);
	assert('4 E krijgt plek 5', rankOf(r, 'E'), 5);
}

// ── 5: alle teams gelijk → iedereen plek 1 ───────────────────────────────────
{
	const e: BattleEntry[] = [
		{ teamId: 'A', score: 0 },
		{ teamId: 'B', score: 0 },
		{ teamId: 'C', score: 0 }
	];
	const r = computeBattleRanking(e);
	assert(
		'5 alles gelijk → alle plekken 1',
		r.map((x) => x.rank),
		[1, 1, 1]
	);
}

// ── 6: wie niets inleverde staat er met 0 en dus onderaan ────────────────────
{
	const e: BattleEntry[] = [
		{ teamId: 'A', score: 14 },
		{ teamId: 'B', score: 0 },
		{ teamId: 'C', score: 3 }
	];
	const r = computeBattleRanking(e);
	assert(
		'6 nul-team onderaan, wel in de lijst',
		r.map((x) => x.team_id),
		['A', 'C', 'B']
	);
	assert('6 lengte = aantal teams', r.length, 3);
}

// ── 7: randgevallen ──────────────────────────────────────────────────────────
{
	assert('7 lege invoer → lege ranglijst', computeBattleRanking([]), []);
	const solo = computeBattleRanking([{ teamId: 'A', score: 7 }]);
	assert('7 één team → plek 1', solo, [{ team_id: 'A', rank: 1, score: 7 }]);
	// Een negatieve challenge-score kan uit een penalty komen; die hoort gewoon
	// onderaan te sorteren en niet als "geen inzending" te lezen.
	const neg = computeBattleRanking([
		{ teamId: 'A', score: 0 },
		{ teamId: 'B', score: -4 }
	]);
	assert(
		'7 negatieve score sorteert onder 0',
		neg.map((x) => x.team_id),
		['A', 'B']
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
	'\n(DB-integratie: CAS-idempotentie + "resolutie raakt geen score aan" — live meegenomen.)'
);
if (passed !== checks.length) process.exit(1);
