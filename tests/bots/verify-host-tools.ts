// GEDRAGSCONTROLE voor de vier host-ingrepen (src/lib/server/host-tools.ts).
//
//   npm run bots:verify-host-tools
//
// ── Wat hier bewaakt wordt ───────────────────────────────────────────────────
//
// De vier beloftes die de host vrijdag moet kunnen vertrouwen:
//
//   1. elke ingreep vraagt een reden, en die reden komt in activity_log
//   2. geen enkele ingreep raakt de score of de staat van een ANDER team
//   3. een score zakt nooit onder nul
//   4. een reset draait terug wat er teruggedraaid hoort te worden, en niets meer
//
// Belofte 2 wordt niet gecontroleerd door de uitkomst te bekijken maar door het
// OPERATIELOG te lezen: elke schrijfquery moet een team_id-filter dragen, en dat
// filter moet het team van de ingreep zijn. Zo faalt deze test ook op een query
// die per ongeluk zonder afbakening geschreven wordt en in deze nep-wereld
// toevallig niets kapotmaakt.
//
// De nep-Supabase valideert kolomnamen tegen de echte schemalijst
// (tests/bots/fake-supabase.ts), dus een typefout in een kolom is hier een rode
// regel in plaats van een lege uitkomst op de avond zelf.
//
// Er wordt geen SQL gedraaid en geen migratie uitgevoerd.

import { makeFake, makeAsserter, opsOn, type Op } from './fake-supabase.ts';
import {
	adjustTeamScore,
	grantExtraTime,
	grantPowerup,
	resetTeamChallenge,
	recomputeCrownHolder,
	SCORE_ONDERGRENS
} from '../../src/lib/server/host-tools.ts';

const { checks, assert } = makeAsserter();
function assertTrue(name: string, cond: boolean, detail: string) {
	checks.push({ name, pass: cond, detail });
	console.log(`  ${cond ? '✓' : '✗'} ${name}  ${detail}`);
}

const ACTOR = { id: 'host-1', email: 'host@example.com' };
const TEAM_A = 'team-a';
const TEAM_B = 'team-b';
const SET = 'set-1';
const CHALLENGE = 'chal-1';

/** De wereld waarin elke ingreep hieronder draait. Per test opnieuw opgebouwd. */
type Wereld = {
	scoreA: number;
	scoreB: number;
	crown: string | null;
	submissions: Array<{ id: string; score: number; answers: unknown }>;
	attemptOpen: boolean;
	battleResolved: boolean;
	powerupType?: Record<string, unknown>;
};

function fakeVoor(w: Wereld) {
	return makeFake((op: Op) => {
		if (op.table === 'teams' && op.kind === 'select') {
			// Eén team (de ingreep zelf) of alle teams (de kroonherberekening).
			if (op.filters.id === TEAM_A) return { score: w.scoreA, display_name: 'Blauw' };
			if (op.filters.id === TEAM_B) return { score: w.scoreB, display_name: 'Geel' };
			return [
				{ id: TEAM_A, score: w.scoreA },
				{ id: TEAM_B, score: w.scoreB }
			];
		}
		if (op.table === 'players') return [{ team_id: TEAM_A }, { team_id: TEAM_B }];
		if (op.table === 'game_sets' && op.kind === 'select') {
			// Twee lezers met verschillende kolommen: de kroonherberekening en
			// activatePowerup's controle of de set actief is.
			if ((op.cols ?? '').includes('crown_holder_team_id')) {
				return { crown_holder_team_id: w.crown, team_count: 2 };
			}
			return { status: 'active', play_state: 'playing', powerup_config: {} };
		}
		if (op.table === 'set_challenges') {
			return { battle_resolved_at: w.battleResolved ? '2026-08-28T20:00:00Z' : null };
		}
		if (op.table === 'submissions' && op.kind === 'select') return w.submissions;
		if (op.table === 'challenge_attempts' && op.kind === 'select') {
			return w.attemptOpen ? { id: 'att-1' } : null;
		}
		if (op.table === 'powerup_types') return w.powerupType ?? null;
		if (op.table === 'team_powerups' && op.kind === 'insert') return { id: 'tpu-nieuw' };
		if (op.table === 'team_powerups' && op.kind === 'select') {
			// activatePowerup leest de zojuist ingevoegde rij terug.
			return {
				id: 'tpu-nieuw',
				team_id: TEAM_A,
				set_id: SET,
				powerup_type_id: (w.powerupType?.id as string) ?? 'bonus_points',
				status: 'pending'
			};
		}
		if (op.table === 'team_powerups' && op.kind === 'update') return [{ id: 'tpu-oud' }];
		if (op.table === 'team_effects' && op.kind === 'insert') return { id: 'eff-1' };
		return null;
	});
}

/** De laatste activity_log-payload uit het log. */
function laatsteLog(log: Op[]): Record<string, unknown> | null {
	const rijen = opsOn(log, 'activity_log', 'insert');
	if (rijen.length === 0) return null;
	return (rijen[rijen.length - 1].values ?? null) as Record<string, unknown> | null;
}

/**
 * BELOFTE 2, structureel: geen schrijfquery mag een ander team raken.
 *
 * Kijkt naar elke insert/update/delete in het log. Draagt hij een team_id — als
 * filter of als waarde — dan moet dat het team van de ingreep zijn. Een
 * schrijfquery zonder enige teamafbakening op een teamgebonden tabel is ook fout
 * en wordt apart gemeld.
 *
 * game_sets is de enige uitzondering en die is expliciet: daar schrijft de
 * kroonherberekening één kolom, en die kolom IS per definitie set-breed.
 */
function raaktAlleenTeam(log: Op[], teamId: string): { ok: boolean; detail: string } {
	const teamTabellen = [
		'teams',
		'team_powerups',
		'team_effects',
		'submissions',
		'challenge_attempts',
		'activity_log'
	];
	for (const op of log) {
		if (op.kind === 'select') continue;
		if (!teamTabellen.includes(op.table)) continue;

		const filterTeam = op.filters['team_id'] ?? op.filters['id'];
		const waardeTeam = !Array.isArray(op.values)
			? ((op.values as Record<string, unknown> | undefined)?.team_id as string | undefined)
			: undefined;

		if (op.table === 'teams') {
			if (op.filters['id'] !== teamId) {
				return { ok: false, detail: `${op.kind} op teams met id=${String(op.filters['id'])}` };
			}
			continue;
		}
		if (filterTeam !== undefined && filterTeam !== teamId) {
			return { ok: false, detail: `${op.kind} op ${op.table} met team_id=${String(filterTeam)}` };
		}
		if (waardeTeam !== undefined && waardeTeam !== teamId) {
			return { ok: false, detail: `${op.kind} op ${op.table} schrijft team_id=${waardeTeam}` };
		}
		if (filterTeam === undefined && waardeTeam === undefined) {
			return { ok: false, detail: `${op.kind} op ${op.table} zonder teamafbakening` };
		}
	}
	return { ok: true, detail: `elke schrijfquery is afgebakend op ${teamId}` };
}

const basis = (): Wereld => ({
	scoreA: 20,
	scoreB: 30,
	crown: TEAM_B,
	submissions: [],
	attemptOpen: false,
	battleResolved: false
});

// ═══ 1. PUNTEN ══════════════════════════════════════════════════════════════
console.log('\n── 1. Punten geven of afnemen ──');
{
	const w = basis();
	const { db, log } = fakeVoor(w);
	const res = await adjustTeamScore(db, {
		teamId: TEAM_A,
		setId: SET,
		delta: 7,
		reason: 'quiz-vraag verkeerd voorgelezen',
		actor: ACTOR
	});
	assert('punten erbij', res.ok && res.newScore, 27);
	const payload = laatsteLog(log);
	assert('event_type', payload?.event_type, 'score_adjustment');
	const p = payload?.payload as Record<string, unknown>;
	assert('reden in het log', p?.reason, 'quiz-vraag verkeerd voorgelezen');
	assert('wie het deed', p?.actor, 'host@example.com');
	assert('herkenbaar als host-ingreep', p?.source, 'host_console');
	assert('oude en nieuwe score in het log', [p?.old_score, p?.new_score], [20, 27]);
	const raakt = raaktAlleenTeam(log, TEAM_A);
	assertTrue('raakt geen ander team', raakt.ok, raakt.detail);
}
{
	const w = basis();
	const { db } = fakeVoor(w);
	const res = await adjustTeamScore(db, {
		teamId: TEAM_A,
		setId: SET,
		delta: -50,
		reason: 'valsgespeeld',
		actor: ACTOR
	});
	assert('score zakt niet onder nul', res.ok && res.newScore, SCORE_ONDERGRENS);
	assertTrue(
		'de klemming staat in de uitkomst',
		res.ok && res.clamped === true,
		'clamped: true — de host krijgt te zien dat er minder is afgetrokken dan hij intikte'
	);
}
{
	const { db } = fakeVoor(basis());
	const zonderReden = await adjustTeamScore(db, {
		teamId: TEAM_A,
		setId: SET,
		delta: 5,
		reason: '   ',
		actor: ACTOR
	});
	const nulPunten = await adjustTeamScore(db, {
		teamId: TEAM_A,
		setId: SET,
		delta: 0,
		reason: 'niets',
		actor: ACTOR
	});
	assertTrue(
		'weigert zonder reden',
		!zonderReden.ok,
		zonderReden.ok ? 'werd geaccepteerd' : zonderReden.error
	);
	assertTrue(
		'weigert een delta van 0',
		!nulPunten.ok,
		nulPunten.ok ? 'geaccepteerd' : nulPunten.error
	);
}

// ═══ 2. POWERUP ═════════════════════════════════════════════════════════════
console.log('\n── 2. Powerup toekennen ──');
{
	const w = basis();
	w.powerupType = {
		id: 'shield',
		name: 'Shield',
		immediate_use: false,
		holdable: true,
		coming_soon: false
	};
	const { db, log } = fakeVoor(w);
	const res = await grantPowerup(db, {
		teamId: TEAM_A,
		setId: SET,
		typeId: 'shield',
		reason: 'compensatie voor de haperende speaker',
		actor: ACTOR
	});
	const ins = opsOn(log, 'team_powerups', 'insert')[0]?.values as Record<string, unknown>;
	assert('holdable komt in de voorraad', res.ok && res.gedrag, 'in_voorraad');
	assert('status held, dus meteen bruikbaar', ins?.status, 'held');
	assert('hangt aan geen challenge', ins?.granted_from_challenge_id, null);
	const p = laatsteLog(log)?.payload as Record<string, unknown>;
	assert('eigen event_type', laatsteLog(log)?.event_type, 'host_powerup_granted');
	assert('niet als verdiend te lezen', [p?.source, p?.powerup_name], ['host_console', 'Shield']);
}
{
	const w = basis();
	w.powerupType = {
		id: 'bonus_points',
		name: 'Bonus Points',
		immediate_use: true,
		holdable: false,
		coming_soon: false
	};
	const { db, log } = fakeVoor(w);
	const res = await grantPowerup(db, {
		teamId: TEAM_A,
		setId: SET,
		typeId: 'bonus_points',
		reason: 'goedmakertje',
		actor: ACTOR
	});
	const ins = opsOn(log, 'team_powerups', 'insert')[0]?.values as Record<string, unknown>;
	assert('immediate_use vuurt direct', res.ok && res.gedrag, 'vuurt_direct');
	assert('gaat via pending, net als een verdiende', ins?.status, 'pending');
	assertTrue(
		'de activatie is echt gelopen',
		res.ok && res.activated === true && opsOn(log, 'team_effects', 'insert').length === 1,
		'activatePowerup schreef de team_effects-rij — hetzelfde pad als materializeAward'
	);
	const p = laatsteLog(log)?.payload as Record<string, unknown>;
	assert('log zegt dat hij direct afging', [p?.immediate_use, p?.activated], [true, true]);
}
{
	const w = basis();
	w.powerupType = {
		id: 'lifeline',
		name: 'Lifeline',
		immediate_use: false,
		holdable: true,
		coming_soon: true
	};
	const { db } = fakeVoor(w);
	const res = await grantPowerup(db, {
		teamId: TEAM_A,
		setId: SET,
		typeId: 'lifeline',
		reason: 'test',
		actor: ACTOR
	});
	assertTrue('weigert een ongebouwd type', !res.ok, res.ok ? 'werd toegekend' : res.error);
}

// ═══ 3. EXTRA TIJD ══════════════════════════════════════════════════════════
console.log('\n── 3. Extra tijd ──');
{
	const w = basis();
	w.attemptOpen = true;
	const { db, log } = fakeVoor(w);
	const res = await grantExtraTime(db, {
		teamId: TEAM_A,
		setId: SET,
		challengeId: CHALLENGE,
		seconds: 45,
		reason: 'telefoon liep vast',
		actor: ACTOR
	});
	const eff = opsOn(log, 'team_effects', 'insert')[0]?.values as Record<string, unknown>;
	const payload = eff?.payload as Record<string, unknown>;
	assert('45 seconden toegekend', res.ok && res.seconds, 45);
	assertTrue(
		'schrijft dezelfde rij als een Time Boost',
		eff?.effect_type === 'time_boost' &&
			payload?.added_seconds === 45 &&
			payload?.challenge_id === CHALLENGE,
		'time_boost met { added_seconds, challenge_id } — de vorm die de telefoon leest én die /api/auto-submit in de deadline meetelt'
	);
	assert('gemerkt als host-tijd', payload?.source, 'host');
	assertTrue(
		'vooraf geconsumeerd',
		typeof eff?.consumed_at === 'string',
		'consumed_at gezet, dus het is een markeerrij en geen effect dat nog moet worden verbruikt'
	);
	assert(
		'log met seconden en reden',
		[
			(laatsteLog(log)?.payload as Record<string, unknown>)?.seconds,
			(laatsteLog(log)?.payload as Record<string, unknown>)?.reason
		],
		[45, 'telefoon liep vast']
	);
	assert('log wijst de challenge aan', laatsteLog(log)?.challenge_id, CHALLENGE);
}
{
	const w = basis();
	w.attemptOpen = false;
	const { db, log } = fakeVoor(w);
	const res = await grantExtraTime(db, {
		teamId: TEAM_A,
		setId: SET,
		challengeId: CHALLENGE,
		seconds: 60,
		reason: 'test',
		actor: ACTOR
	});
	assertTrue('weigert zonder lopende beurt', !res.ok, res.ok ? 'geaccepteerd' : res.error);
	assert('en schrijft dan niets', opsOn(log, 'team_effects', 'insert').length, 0);
}
{
	const w = basis();
	w.attemptOpen = true;
	const { db } = fakeVoor(w);
	const teVeel = await grantExtraTime(db, {
		teamId: TEAM_A,
		setId: SET,
		challengeId: CHALLENGE,
		seconds: 99999,
		reason: 'test',
		actor: ACTOR
	});
	assertTrue(
		'weigert een onzinnig aantal seconden',
		!teVeel.ok,
		teVeel.ok ? 'geaccepteerd' : teVeel.error
	);
}

// ═══ 4. CHALLENGE TERUGZETTEN ═══════════════════════════════════════════════
console.log('\n── 4. Challenge terugzetten ──');
{
	const w = basis();
	// De punten komen uit breakdown.final, niet uit submissions.score: dat is de
	// waarde die bij het inleveren daadwerkelijk is opgeteld.
	w.submissions = [{ id: 'sub-1', score: 8, answers: [{ breakdown: { final: 12 } }] }];
	const { db, log } = fakeVoor(w);
	const res = await resetTeamChallenge(db, {
		teamId: TEAM_A,
		setId: SET,
		challengeId: CHALLENGE,
		reason: 'clip speelde niet af',
		actor: ACTOR
	});
	assert('trekt breakdown.final af, niet score', res.ok && res.pointsDeducted, 12);
	assert('nieuwe score', res.ok && res.newScore, 8);
	assertTrue(
		'verwijdert de inlevering én de beurt',
		opsOn(log, 'submissions', 'delete').length === 1 &&
			opsOn(log, 'challenge_attempts', 'delete').length === 1,
		'beide afgebakend op (challenge, team)'
	);
	const revoke = opsOn(log, 'team_powerups', 'update')[0];
	assert(
		'trekt alleen ONGEBRUIKTE powerups in',
		(revoke?.values as Record<string, unknown>)?.status,
		'lost'
	);
	assert(
		'en alleen die van deze challenge',
		revoke?.filters['granted_from_challenge_id'],
		CHALLENGE
	);
	assert('alleen pending en held', revoke?.filters['status'], ['pending', 'held']);
	const p = laatsteLog(log)?.payload as Record<string, unknown>;
	assert('event_type blijft attempt_reset', laatsteLog(log)?.event_type, 'attempt_reset');
	assert('log met reden en bedrag', [p?.reason, p?.score_deducted], ['clip speelde niet af', 12]);
	const raakt = raaktAlleenTeam(log, TEAM_A);
	assertTrue('raakt geen ander team', raakt.ok, raakt.detail);

	// Wat NIET gebeurt, expliciet: geen enkele query raakt de streak of de
	// drempel, want die lopen over meerdere challenges.
	const streakSchrijf = opsOn(log, 'teams', 'update').some((o) => {
		const v = o.values as Record<string, unknown>;
		return 'current_streak' in v || 'last_threshold_crossed' in v;
	});
	assertTrue(
		'laat streak en drempel met rust',
		!streakSchrijf,
		'die lopen over meerdere challenges — terugdraaien zou andere challenges van hetzelfde team raken'
	);
}
{
	const w = basis();
	w.submissions = [{ id: 'sub-1', score: 40, answers: [{ breakdown: { final: 40 } }] }];
	const { db } = fakeVoor(w);
	const res = await resetTeamChallenge(db, {
		teamId: TEAM_A,
		setId: SET,
		challengeId: CHALLENGE,
		reason: 'meer aftrekken dan er staat',
		actor: ACTOR
	});
	assert('aftrek stopt op nul', res.ok && res.newScore, SCORE_ONDERGRENS);
}
{
	const w = basis();
	w.battleResolved = true;
	const { db, log } = fakeVoor(w);
	const res = await resetTeamChallenge(db, {
		teamId: TEAM_A,
		setId: SET,
		challengeId: CHALLENGE,
		reason: 'test',
		actor: ACTOR
	});
	assertTrue('weigert een beslechte battle', !res.ok, res.ok ? 'werd teruggezet' : res.error);
	assert('en verandert dan niets', log.filter((o) => o.kind !== 'select').length, 0);
}
{
	const { db } = fakeVoor(basis());
	const res = await resetTeamChallenge(db, {
		teamId: TEAM_A,
		setId: SET,
		challengeId: CHALLENGE,
		reason: '',
		actor: ACTOR
	});
	assertTrue('weigert zonder reden', !res.ok, res.ok ? 'geaccepteerd' : res.error);
}

// ═══ De kroon na een ingreep ════════════════════════════════════════════════
console.log('\n── De kroon ──');
{
	// Team A staat na een correctie boven B: de kroon verhuist, ZONDER de +1
	// steelbonus die maybeTransferCrown in het spel wel uitdeelt.
	const w = basis();
	w.scoreA = 50;
	w.scoreB = 30;
	w.crown = TEAM_B;
	const { db, log } = fakeVoor(w);
	await recomputeCrownHolder(db, SET);
	const upd = opsOn(log, 'game_sets', 'update')[0]?.values as Record<string, unknown>;
	assert('kroon naar de echte koploper', upd?.crown_holder_team_id, TEAM_A);
	assert('geen enkele score aangeraakt', opsOn(log, 'teams', 'update').length, 0);
}
{
	// De houder is gezakt en niemand heeft hem "overgenomen" — maybeTransferCrown
	// zou hier niets doen en de kroon bij een team laten staan dat niet meer leidt.
	const w = basis();
	w.scoreA = 30;
	w.scoreB = 5;
	w.crown = TEAM_B;
	const { db, log } = fakeVoor(w);
	await recomputeCrownHolder(db, SET);
	const upd = opsOn(log, 'game_sets', 'update')[0]?.values as Record<string, unknown>;
	assert('kroon volgt ook een DALING', upd?.crown_holder_team_id, TEAM_A);
}
{
	const w = basis();
	w.scoreA = 30;
	w.scoreB = 30;
	w.crown = TEAM_B;
	const { db, log } = fakeVoor(w);
	await recomputeCrownHolder(db, SET);
	assert('gelijkspel laat de zittende houder staan', opsOn(log, 'game_sets', 'update').length, 0);
}
{
	const w = basis();
	w.scoreA = 0;
	w.scoreB = 0;
	w.crown = TEAM_B;
	const { db, log } = fakeVoor(w);
	await recomputeCrownHolder(db, SET);
	const upd = opsOn(log, 'game_sets', 'update')[0]?.values as Record<string, unknown>;
	assert('niemand op punten -> geen kroon', upd?.crown_holder_team_id, null);
}

// ═══ Falsificatie ═══════════════════════════════════════════════════════════
// Gaat de teamafbakening-controle ook echt rood? Zonder dit zou een controle die
// altijd groen is er even overtuigend uitzien.
console.log('\n── Falsificatie ──');
{
	const nep: Op[] = [
		{ table: 'teams', kind: 'update', filters: { id: TEAM_B }, values: { score: 999 } }
	];
	const uitkomst = raaktAlleenTeam(nep, TEAM_A);
	assertTrue(
		'een schrijfquery op een ander team wordt gepakt',
		!uitkomst.ok,
		uitkomst.ok ? 'werd doorgelaten — deze controle bewijst niets' : uitkomst.detail
	);
}

// ── Rapport ─────────────────────────────────────────────────────────────────
let failed = 0;
for (const c of checks) if (!c.pass) failed++;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
