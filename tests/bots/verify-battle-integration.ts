// Battle Mode INTEGRATION harness — exercises the REAL resolveBattle against the
// live DB with multiple simulated teams.
//
//   npm run bots:verify-battle-integration
//
// The gap between the pure-math verify-battle (computeBattleRanking in isolation)
// and verify-regression (non-battle scoring unchanged): this proves the DB wiring
// end-to-end — submissions.score → resolveBattle → een opgeslagen ranglijst +
// de ladderbonus op teams.score, CAS idempotency, en maybeResolveBattle's
// all-done detection against real attempt rows.
//
// TWEE DINGEN MOETEN TEGELIJK WAAR ZIJN, en dat is precies wat hier wordt
// vastgelegd: (a) de ladderbonus wordt bij teams.score opgeteld — de exacte
// getallen staan per scenario met de hand uitgeschreven; (b) de KROON beweegt
// daar niet van mee. De batch-hercalculatie die vroeger aan de bonus hing
// (recomputeCrownAfterBattle, +1 steal) is bewust weg: een battle deelt punten
// uit maar verplaatst de kroon niet.
//
// How it drives the real code: tsx can't import resolveBattle (its $lib runtime
// imports only resolve inside Vite), so the harness seeds controlled state at the
// DB level (submissions with a chosen score, attempts, teams.score = the "full
// challenge score already added at submit") and then POSTs the DEV-only
// /api/dev/battle-resolve endpoint to run the REAL resolveBattle /
// maybeResolveBattle in-app. Seeding the submit side lets us assert against exact
// numbers (precision the browser can't give); the resolution side is the genuine
// production code path.
//
// Oracle: expected ranks EN bonussen zijn per scenario met de hand geschreven
// (NIET via computeBattleRanking/deriveLadder berekend) zodat de test niet
// circulair is. Met 4 teams en max_points 10 is de ladder [10, 7, 3, 0].
//
// FIXTURE HYGIENE (the ch20-pollution lesson): ch20's points_config is snapshotted
// before the run and restored in a finally; battle state is reset before AND after.
// Run twice — the second run must be identical, no drift.
//
// Requires: app running (BOT_BASE_URL) with migration 0061 applied.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TEAM_COLOR_ORDER } from '../../src/lib/server/randomize';
import { BOT_BASE_URL } from './config';

function loadEnv() {
	try {
		const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
		for (const line of raw.split('\n')) {
			const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
			if (!m) continue;
			let val = m[2].trim();
			if (
				(val.startsWith('"') && val.endsWith('"')) ||
				(val.startsWith("'") && val.endsWith("'"))
			) {
				val = val.slice(1, -1);
			}
			if (!(m[1] in process.env)) process.env[m[1]] = val;
		}
	} catch {
		/* rely on the real environment */
	}
}

const SET_ID = 'e5100000-0000-4000-8000-000000000001';
const BATTLE_CH = 'e5100000-0000-4000-8000-000000000020'; // ch20 — the dedicated battle challenge for this run
const ATTEMPT_BASE = new Date('2024-01-01T00:00:00.000Z').getTime(); // absolute time is irrelevant; only ended−started matters

// ─── report plumbing ──────────────────────────────────────────────────────────
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

// ─── DB helpers ─────────────────────────────────────────────────────────────
type Team = { id: string; color: string };

async function scopedTeams(db: SupabaseClient): Promise<Team[]> {
	const { data: gs } = await db
		.from('game_sets')
		.select('team_count')
		.eq('id', SET_ID)
		.maybeSingle();
	const teamCount = (gs?.team_count as number | undefined) ?? 6;
	const colors = TEAM_COLOR_ORDER.slice(0, teamCount);
	const { data: teams } = await db.from('teams').select('id, color').in('color', colors);
	// Preserve TEAM_COLOR_ORDER (getTeamsInSet does — the crown tiebreak relies on it).
	return colors
		.map((c) => (teams ?? []).find((t) => t.color === c))
		.filter((t): t is { id: string; color: string } => t != null)
		.map((t) => ({ id: t.id, color: t.color }));
}

/** Clear all battle-relevant state so each scenario starts clean. */
async function resetBattle(db: SupabaseClient, teams: Team[]) {
	const teamIds = teams.map((t) => t.id);
	await db.from('submissions').delete().eq('challenge_id', BATTLE_CH);
	await db.from('challenge_attempts').delete().eq('challenge_id', BATTLE_CH);
	await db.from('teams').update({ score: 0, current_streak: 0 }).in('id', teamIds);
	await db
		.from('set_challenges')
		.update({ battle_resolved_at: null, battle_ranking: null })
		.eq('set_id', SET_ID)
		.eq('challenge_id', BATTLE_CH);
	await db
		.from('game_sets')
		.update({ crown_holder_team_id: null, crown_payout_applied: false })
		.eq('id', SET_ID);
	// Clear prior battle activity logs so per-scenario crown-log counts are clean.
	await db.from('activity_log').delete().in('team_id', teamIds).eq('event_type', 'battle_award');
	await db.from('activity_log').delete().in('team_id', teamIds).eq('event_type', 'crown_stolen');
}

/** Simulate a team having submitted the battle challenge: attempt + submission +
 *  the challenge score already added to teams.score at submit. `score` is zowel
 *  wat het team op deze challenge kreeg als de ranglijst-sleutel — dat is precies
 *  het punt: de battle rangschikt de ECHTE challengescore. */
async function seedSubmission(
	db: SupabaseClient,
	teamId: string,
	opts: { score: number; elapsedSec: number }
) {
	const startedAt = new Date(ATTEMPT_BASE).toISOString();
	const endedAt = new Date(ATTEMPT_BASE + opts.elapsedSec * 1000).toISOString();
	await db
		.from('challenge_attempts')
		.insert({ challenge_id: BATTLE_CH, team_id: teamId, started_at: startedAt, ended_at: endedAt });
	await db.from('submissions').insert({
		challenge_id: BATTLE_CH,
		team_id: teamId,
		answers: [],
		score: opts.score,
		is_final: true
	});
	await db.from('teams').update({ score: opts.score }).eq('id', teamId);
}

async function teamScore(db: SupabaseClient, teamId: string): Promise<number> {
	const { data } = await db.from('teams').select('score').eq('id', teamId).maybeSingle();
	return (data?.score as number | undefined) ?? -1;
}

async function battleRanking(db: SupabaseClient): Promise<Array<Record<string, unknown>>> {
	const { data } = await db
		.from('set_challenges')
		.select('battle_ranking')
		.eq('set_id', SET_ID)
		.eq('challenge_id', BATTLE_CH)
		.maybeSingle();
	return (data?.battle_ranking as Array<Record<string, unknown>> | null) ?? [];
}

async function resolvedAt(db: SupabaseClient): Promise<string | null> {
	const { data } = await db
		.from('set_challenges')
		.select('battle_resolved_at')
		.eq('set_id', SET_ID)
		.eq('challenge_id', BATTLE_CH)
		.maybeSingle();
	return (data?.battle_resolved_at as string | null) ?? null;
}

async function crownHolder(db: SupabaseClient): Promise<string | null> {
	const { data } = await db
		.from('game_sets')
		.select('crown_holder_team_id')
		.eq('id', SET_ID)
		.maybeSingle();
	return (data?.crown_holder_team_id as string | null) ?? null;
}

async function battleCrownLogCount(db: SupabaseClient, teamIds: string[]): Promise<number> {
	const { data } = await db
		.from('activity_log')
		.select('payload')
		.eq('event_type', 'crown_stolen')
		.in('team_id', teamIds);
	return (data ?? []).filter((r) => (r.payload as { via?: string } | null)?.via === 'battle')
		.length;
}

async function setCrown(db: SupabaseClient, teamId: string) {
	await db.from('game_sets').update({ crown_holder_team_id: teamId }).eq('id', SET_ID);
}

async function callResolve(mode: 'resolve' | 'maybe'): Promise<Record<string, unknown>> {
	const res = await fetch(`${BOT_BASE_URL}/api/dev/battle-resolve`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ setId: SET_ID, challengeId: BATTLE_CH, mode })
	});
	return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** Runs the REAL resolveBattlesForRecap — the same set-wide barrier startRecap and
 *  the auto-submit recap flip call. Set-scoped: no challengeId. */
async function callRecapBarrier(): Promise<Record<string, unknown>> {
	const res = await fetch(`${BOT_BASE_URL}/api/dev/battle-resolve`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ setId: SET_ID, mode: 'recap-barrier' })
	});
	return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

const scoreFor = (ranking: Array<Record<string, unknown>>, teamId: string) =>
	ranking.find((r) => r.team_id === teamId)?.score ?? null;
const rankFor = (ranking: Array<Record<string, unknown>>, teamId: string) =>
	ranking.find((r) => r.team_id === teamId)?.rank ?? null;
const awardFor = (ranking: Array<Record<string, unknown>>, teamId: string) =>
	ranking.find((r) => r.team_id === teamId)?.awarded ?? null;

/** Hoeveel battle_award-regels resolveBattle schreef (één per team met bonus). */
async function battleAwardLogCount(db: SupabaseClient, teamIds: string[]): Promise<number> {
	const { count } = await db
		.from('activity_log')
		.select('*', { count: 'exact', head: true })
		.eq('event_type', 'battle_award')
		.in('team_id', teamIds);
	return count ?? 0;
}

// ─── scenarios ────────────────────────────────────────────────────────────────
// t[0]=blue t[1]=yellow t[2]=green t[3]=red (TEAM_COLOR_ORDER for team_count 4)

/** De teamscores in TEAM_COLOR_ORDER — de basis van elke bonus-assert. */
async function allScores(db: SupabaseClient, t: Team[]): Promise<number[]> {
	return Promise.all(t.map((x) => teamScore(db, x.id)));
}

async function s1RanksAndAwards(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	// Vier verschillende challengescores → vier verschillende plekken → de hele
	// ladder [10,7,3,0] wordt uitgedeeld.
	await seedSubmission(db, t[0].id, { score: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { score: 20, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { score: 12, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { score: 0, elapsedSec: 30 }); // speelde, leeg
	await setCrown(db, t[0].id);

	await callResolve('resolve');

	const r = await battleRanking(db);
	assert('S1 blue plek 1 met 40', [rankFor(r, t[0].id), scoreFor(r, t[0].id)], [1, 40]);
	assert('S1 yellow plek 2 met 20', [rankFor(r, t[1].id), scoreFor(r, t[1].id)], [2, 20]);
	assert('S1 green plek 3 met 12', [rankFor(r, t[2].id), scoreFor(r, t[2].id)], [3, 12]);
	assert('S1 red plek 4 met 0', [rankFor(r, t[3].id), scoreFor(r, t[3].id)], [4, 0]);
	assert(
		'S1 bonus per plek = [10,7,3,0]',
		t.map((x) => awardFor(r, x.id)),
		[10, 7, 3, 0]
	);
	assert('S1 battle_resolved_at set', (await resolvedAt(db)) != null, true);
	// DE kernassert: challengescore + bonus staan in teams.score.
	assert('S1 teamscores = challengescore + bonus', await allScores(db, t), [50, 27, 15, 0]);
	assert(
		'S1 één battle_award-regel per team MET bonus (rank 4 krijgt niets)',
		await battleAwardLogCount(
			db,
			t.map((x) => x.id)
		),
		3
	);
	// De kroon volgt de bonus NIET.
	assert('S1 kroon onaangeroerd', await crownHolder(db), t[0].id);
	assert(
		'S1 geen kroon-log uit een battle',
		await battleCrownLogCount(
			db,
			t.map((x) => x.id)
		),
		0
	);
}

async function s2SharedFirstPlace(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	// blue en yellow scoorden allebei 30 — en blue was sneller. Snelheid telt NIET
	// mee: gelijke score is een GEDEELDE eerste plaats waar BEIDE teams de
	// hoogste bonus voor krijgen, en de volgende plek slaat de verbruikte plek
	// over (competition numbering) met de bonus die daarbij hoort.
	await seedSubmission(db, t[0].id, { score: 30, elapsedSec: 20 });
	await seedSubmission(db, t[1].id, { score: 30, elapsedSec: 40 });
	await seedSubmission(db, t[2].id, { score: 12, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { score: 6, elapsedSec: 30 });
	await setCrown(db, t[0].id);

	await callResolve('resolve');

	const r = await battleRanking(db);
	assert('S2 blue en yellow delen plek 1', [rankFor(r, t[0].id), rankFor(r, t[1].id)], [1, 1]);
	assert('S2 snelheid breekt de gelijke stand NIET', scoreFor(r, t[1].id), 30);
	assert(
		'S2 beide koplopers krijgen de HOOGSTE bonus',
		[awardFor(r, t[0].id), awardFor(r, t[1].id)],
		[10, 10]
	);
	assert('S2 green krijgt plek 3, niet 2', rankFor(r, t[2].id), 3);
	assert('S2 green krijgt de bonus van plek 3', awardFor(r, t[2].id), 3);
	assert('S2 red krijgt plek 4 zonder bonus', [rankFor(r, t[3].id), awardFor(r, t[3].id)], [4, 0]);
	assert('S2 teamscores = challengescore + bonus', await allScores(db, t), [40, 40, 15, 6]);
}

async function s3NonParticipant(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	// red heeft geen attempt/submission → de auto-hook zou niet vuren; direct
	// resolven (het host-pad). red hoort er met 0 gewoon in te staan: de kaart
	// toont ALLE teams — en krijgt als laatste geen bonus.
	await seedSubmission(db, t[0].id, { score: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { score: 12, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { score: 6, elapsedSec: 30 });
	await setCrown(db, t[0].id);

	await callResolve('resolve');

	const r = await battleRanking(db);
	assert('S3 alle vier de teams in de ranglijst', r.length, 4);
	assert('S3 afwezige red plek 4 met 0', [rankFor(r, t[3].id), scoreFor(r, t[3].id)], [4, 0]);
	assert('S3 afwezige red krijgt geen bonus', awardFor(r, t[3].id), 0);
	assert('S3 teamscores = challengescore + bonus', await allScores(db, t), [50, 19, 9, 0]);
}

async function s4Idempotency(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	await seedSubmission(db, t[0].id, { score: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { score: 12, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { score: 6, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { score: 0, elapsedSec: 30 });
	await setCrown(db, t[0].id);

	await callResolve('resolve');
	const after1 = await allScores(db, t);
	const resolvedAt1 = await resolvedAt(db);
	const ranking1 = await battleRanking(db);
	assert('S4 eerste resolve deelde de bonus uit', after1, [50, 19, 9, 0]);

	const res2 = await callResolve('resolve'); // tweede call moet de CAS verliezen
	const after2 = await allScores(db, t);

	assert('S4 second resolve reports resolved:false', res2.resolved, false);
	// DE reden dat de CAS er is: de ladderbonus mag nooit dubbel worden bijgeschreven.
	assert('S4 bonus NIET dubbel bijgeschreven', after2, after1);
	assert('S4 battle_resolved_at unchanged (claimed once)', await resolvedAt(db), resolvedAt1);
	assert('S4 ranglijst ongewijzigd', await battleRanking(db), ranking1);
	assert(
		'S4 geen tweede reeks battle_award-regels',
		await battleAwardLogCount(
			db,
			t.map((x) => x.id)
		),
		3
	);
}

async function s5CrownNeverMoves(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	// Het geval waar de verwijderde recomputeCrownAfterBattle op af ging: blue
	// wint de battle en klimt MET de bonus over yellow heen op het totaal. De
	// punten tellen (40 > 39), maar de kroon blijft waar hij lag.
	await seedSubmission(db, t[0].id, { score: 30, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { score: 12, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { score: 10, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { score: 0, elapsedSec: 30 });
	await db.from('teams').update({ score: 32 }).eq('id', t[1].id); // yellow leidt op totaal
	await setCrown(db, t[1].id);

	await callResolve('resolve');

	const r = await battleRanking(db);
	assert('S5 blue wint de battle', rankFor(r, t[0].id), 1);
	assert('S5 blue krijgt de topbonus', awardFor(r, t[0].id), 10);
	assert('S5 blue gaat met de bonus over yellow heen', await allScores(db, t), [40, 39, 13, 0]);
	assert('S5 kroon blijft toch bij yellow', await crownHolder(db), t[1].id);
	assert(
		'S5 geen kroon-log uit een battle',
		await battleCrownLogCount(
			db,
			t.map((x) => x.id)
		),
		0
	);
}

async function s6AutoHook(db: SupabaseClient, t: Team[]) {
	// (a) Alle vier klaar → maybeResolveBattle moet vanzelf resolven én uitdelen.
	await resetBattle(db, t);
	await seedSubmission(db, t[0].id, { score: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { score: 20, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { score: 12, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { score: 6, elapsedSec: 30 });
	await setCrown(db, t[0].id);
	await callResolve('maybe');
	assert(
		'S6a all-done → auto-resolved (battle_resolved_at set)',
		(await resolvedAt(db)) != null,
		true
	);
	assert('S6a auto-resolve deelt de bonus uit', await allScores(db, t), [50, 27, 15, 6]);

	// (b) Eén team startte nooit → maybeResolveBattle mag NIET resolven, en dus
	// ook geen enkele bonus uitdelen.
	await resetBattle(db, t);
	await seedSubmission(db, t[0].id, { score: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { score: 20, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { score: 12, elapsedSec: 30 });
	// t[3] (red) heeft geen attempt
	const beforeB = await allScores(db, t);
	await callResolve('maybe');
	assert(
		'S6b partial turnout → NOT resolved (battle_resolved_at null)',
		await resolvedAt(db),
		null
	);
	assert('S6b geen bonus zonder resolutie', await allScores(db, t), beforeB);
}

// ─── de recap-barrière ────────────────────────────────────────────────────────
// De onthulling is een pure weergave van opgeslagen uitkomsten, wat alleen waar
// is als niets onopgelost de recap kan bereiken. Deze drie dekken het contract:
// resolve wat speelbaar is, sla over wat dat niet is, schrijf nooit twee keer.

async function s7aBarrierResolvesAbsentee(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	// Precies het geval dat de auto-hook weigert (S6b): red startte nooit. Zonder
	// barrière bereikt deze set de recap met battle_ranking NULL, verdwijnt de
	// battle uit de onthulling én krijgt niemand zijn bonus.
	await seedSubmission(db, t[0].id, { score: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { score: 20, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { score: 12, elapsedSec: 30 });
	// t[3] (red): afwezig — geen attempt, geen submission
	await setCrown(db, t[0].id);

	await callResolve('maybe');
	assert('S7a precondition: auto-hook leaves it unresolved', await resolvedAt(db), null);

	const res = await callRecapBarrier();

	assert('S7a barrier reports it resolved', (res.resolved as string[])?.length, 1);
	assert('S7a battle_resolved_at now set', (await resolvedAt(db)) != null, true);
	const r = await battleRanking(db);
	assert('S7a battle_ranking populated (all 4 teams)', r.length, 4);
	assert('S7a blue plek 1 met 40', [rankFor(r, t[0].id), scoreFor(r, t[0].id)], [1, 40]);
	assert('S7a afwezige red plek 4 met 0', [rankFor(r, t[3].id), scoreFor(r, t[3].id)], [4, 0]);
	assert('S7a barrière deelt de bonus alsnog uit', await allScores(db, t), [50, 27, 15, 0]);
	assert('S7a kroon onaangeroerd', await crownHolder(db), t[0].id);
}

async function s7bBarrierSkipsZeroSubmissions(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	// Niemand speelde deze battle. Resolven zou de hele ladder uitdelen aan teams
	// die nooit meededen, dus de barrière slaat hem over en laat battle_ranking
	// NULL — de onthulling sluit hem dan uit (die leest WHERE battle_ranking IS
	// NOT NULL).
	const before = await allScores(db, t);
	const res = await callRecapBarrier();
	const after = await allScores(db, t);

	assert(
		'S7b barrier skipped it (no submissions)',
		(res.skippedNoSubmissions as string[])?.length,
		1
	);
	assert('S7b barrier resolved nothing', (res.resolved as string[])?.length, 0);
	assert('S7b battle_resolved_at stays null', await resolvedAt(db), null);
	assert(
		'S7b battle_ranking stays empty → excluded from reveal',
		(await battleRanking(db)).length,
		0
	);
	assert('S7b geen bonus aan teams die niet speelden', after, before);
}

async function s7cBarrierNoDoubleWrite(db: SupabaseClient, t: Team[]) {
	await resetBattle(db, t);
	// DE concurrency-check: een battle die de auto-hook al resolvede, waar
	// startRecap's barrière daarna overheen loopt. resolveBattle CAS-claimt
	// battle_resolved_at eerst, dus de barrière verliest de claim — geen tweede
	// ranglijst-write en, wat hier het echte risico is, geen tweede bonus.
	await seedSubmission(db, t[0].id, { score: 40, elapsedSec: 30 });
	await seedSubmission(db, t[1].id, { score: 20, elapsedSec: 30 });
	await seedSubmission(db, t[2].id, { score: 12, elapsedSec: 30 });
	await seedSubmission(db, t[3].id, { score: 6, elapsedSec: 30 });
	await setCrown(db, t[0].id);

	await callResolve('maybe'); // auto-hook resolvet als eerste (alle teams klaar)
	const afterHook = await allScores(db, t);
	const resolvedAtHook = await resolvedAt(db);
	const rankingHook = await battleRanking(db);
	assert('S7c precondition: auto-hook resolved it', resolvedAtHook != null, true);
	assert('S7c precondition: bonus is uitgedeeld', afterHook, [50, 27, 15, 6]);

	const res = await callRecapBarrier();
	const afterBarrier = await allScores(db, t);

	assert('S7c barrier resolved nothing (already resolved)', (res.resolved as string[])?.length, 0);
	assert('S7c bonus NIET dubbel uitgedeeld', afterBarrier, afterHook);
	assert('S7c battle_resolved_at unchanged (claimed once)', await resolvedAt(db), resolvedAtHook);
	assert('S7c battle_ranking unchanged', await battleRanking(db), rankingHook);
	assert(
		'S7c geen kroon-log uit een battle',
		await battleCrownLogCount(
			db,
			t.map((x) => x.id)
		),
		0
	);
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
	loadEnv();
	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key)
		throw new Error('Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
	const db = createClient(url, key, { auth: { persistSession: false } });

	console.log(`▶ Battle integration verification against ${BOT_BASE_URL}`);
	console.log(`  set: ${SET_ID}  battle challenge: ${BATTLE_CH} (ch20)\n`);

	const teams = await scopedTeams(db);
	if (teams.length < 4) throw new Error(`Expected 4 scoped teams, got ${teams.length}`);

	// Snapshot ch20's points_config — RESTORED in finally (fixture hygiene).
	const { data: chBefore } = await db
		.from('challenges')
		.select('points_config')
		.eq('id', BATTLE_CH)
		.maybeSingle();
	const originalConfig = chBefore?.points_config ?? null;

	try {
		// Make ch20 a battle challenge for the run. max_points 10 + 4 teams geeft
		// de ladder [10, 7, 3, 0]; elke verwachting hieronder rekent daarmee.
		await db
			.from('challenges')
			.update({ points_config: { battle: { enabled: true, max_points: 10 } } })
			.eq('id', BATTLE_CH);

		await s1RanksAndAwards(db, teams);
		await s2SharedFirstPlace(db, teams);
		await s3NonParticipant(db, teams);
		await s4Idempotency(db, teams);
		await s5CrownNeverMoves(db, teams);
		await s6AutoHook(db, teams);
		await s7aBarrierResolvesAbsentee(db, teams);
		await s7bBarrierSkipsZeroSubmissions(db, teams);
		await s7cBarrierNoDoubleWrite(db, teams);
	} finally {
		// Restore ch20's exact original config + wipe all battle/game state we touched.
		await resetBattle(db, teams);
		await db
			.from('challenges')
			.update({ points_config: originalConfig as never })
			.eq('id', BATTLE_CH);
		console.log('↩ restored ch20 points_config + reset battle state\n');
	}

	console.log('─── Results ───');
	for (const c of checks) {
		console.log(`  ${c.pass ? '✅' : '❌'} ${c.name.padEnd(52)} ${c.pass ? '' : c.detail}`);
	}
	const passed = checks.filter((c) => c.pass).length;
	console.log(`\n${passed}/${checks.length} checks passed`);
	if (passed !== checks.length) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
