import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { getTeamsInSet } from '$lib/server/randomize';
import {
	computeBattleRanking,
	deriveLadder,
	parseBattleConfig,
	type BattleEntry,
	type BattleRankEntry
} from '$lib/battle-ranking';

type AdminClient = SupabaseClient<Database>;

// Battle Mode — de resolver. De pure ranglijst-math + config-parser staan in
// $lib/battle-ranking (client-safe, geen server-imports) zodat de harness ze
// los kan draaien; deze module is de DB-lijm: lees wat elk team op de challenge
// scoorde, rangschik, deel de ladderbonus uit, leg de uitslag vast.
//
// Een battle is ALLE teams tegen elkaar op één challenge. De challenge zelf
// wordt gescoord als elke andere (volledige score, multipliers, streak,
// powerups, kroon — alles bij submit, zie scoreAndPersistSubmission); de battle
// rangschikt daarna wat daar uitkwam en telt daar een LADDERBONUS bij op
// (aflopend per plek, laatste plek 0).
//
// Wat hier NIET meer gebeurt: de kroon-hercalculatie die vroeger op de bonus
// volgde (recomputeCrownAfterBattle, +1 steal aan de nieuwe leider). Een battle
// deelt punten uit maar verplaatst de kroon niet.

/**
 * Resolve a battle challenge for one set: rangschik alle set-teams op wat ze op
 * deze challenge scoorden, tel de ladderbonus per plek bij teams.score op en
 * leg de uitslag vast.
 *
 * Idempotent via a CAS claim on set_challenges.battle_resolved_at (claimed FIRST,
 * WHERE battle_resolved_at IS NULL) — same pattern as tryConsumeShield. Concurrent
 * last-team submits race to claim; only the winner awards, zodat de ladderbonus
 * nooit dubbel wordt bijgeschreven. Returns { resolved: false } when the claim
 * was lost (already resolved) or the (set, challenge) pair doesn't exist.
 */
export async function resolveBattle(
	admin: AdminClient,
	setId: string,
	challengeId: string
): Promise<{ resolved: boolean }> {
	// 1. CAS claim — the idempotency guard. Only one caller wins.
	const { data: claimed } = await admin
		.from('set_challenges')
		.update({ battle_resolved_at: new Date().toISOString() } as never)
		.eq('set_id', setId)
		.eq('challenge_id', challengeId)
		.is('battle_resolved_at', null)
		.select('id');
	if (!claimed || claimed.length === 0) return { resolved: false };

	// 2. Max-points from the challenge config.
	const { data: ch } = await admin
		.from('challenges')
		.select('points_config')
		.eq('id', challengeId)
		.maybeSingle();
	const { max_points } = parseBattleConfig(ch?.points_config);

	// 3. Teams in the set (TEAM_COLOR_ORDER-ordered). ALLE teams komen in de
	// ranglijst, ook wie niets inleverde — dat team staat er met 0.
	const teams = await getTeamsInSet(admin, setId);
	const teamIds = teams.map((t) => t.id);
	if (teamIds.length === 0) return { resolved: true };

	// De ladder volgt uit max_points + het ECHTE team_count op resolutiemoment —
	// nooit opgeslagen, dus hij past altijd bij de werkelijke opkomst.
	const ladder = deriveLadder(max_points, teamIds.length);

	// 4. Ranglijst-invoer: wat elk team op DEZE challenge scoorde.
	//
	// `submissions.score` en niet `battle_raw_score`: score is het getal dat het
	// team daadwerkelijk kreeg — hetzelfde getal dat de team-console als
	// "DONE · +N" toont en dat in teams.score belandde. battle_raw_score was de
	// pre-multiplier sorteersleutel van een eerdere ladder-opzet en leest náást
	// het leaderboard als een verkeerde score.
	const { data: subs } = await admin
		.from('submissions')
		.select('team_id, score')
		.eq('challenge_id', challengeId)
		.in('team_id', teamIds);
	const scoreByTeam = new Map((subs ?? []).map((s) => [s.team_id, s.score ?? 0]));
	const entries: BattleEntry[] = teamIds.map((id) => ({
		teamId: id,
		score: scoreByTeam.get(id) ?? 0
	}));

	// 5. Rangschikken + de bonus per plek bepalen.
	const ranking = computeBattleRanking(entries, ladder);

	// 6. De ladderbonus bijschrijven (read-then-write, net als de rest van de
	// score-pijplijn — resolutie draait als alle attempts op deze challenge klaar
	// zijn, een rustig moment, dus een gelijktijdige score-write is onwaarschijnlijk).
	// Per team gelogd als battle_award, zodat /admin/live de bonus kan tonen.
	const { data: curTeams } = await admin.from('teams').select('id, score').in('id', teamIds);
	const scoreById = new Map((curTeams ?? []).map((t) => [t.id, t.score]));
	for (const r of ranking) {
		if (r.awarded <= 0) continue;
		await admin
			.from('teams')
			.update({ score: (scoreById.get(r.team_id) ?? 0) + r.awarded })
			.eq('id', r.team_id);
		await admin.from('activity_log').insert({
			team_id: r.team_id,
			event_type: 'battle_award',
			payload: { challenge_id: challengeId, rank: r.rank, awarded: r.awarded }
		} as never);
	}

	// 7. De uitslag vastleggen. Geen kroon-hercalculatie: een battle verplaatst
	// de kroon niet.
	await admin
		.from('set_challenges')
		.update({ battle_ranking: ranking as never } as never)
		.eq('set_id', setId)
		.eq('challenge_id', challengeId);

	return { resolved: true };
}

/**
 * Recap resolution barrier (stuk 3a). Resolves every still-unresolved battle in
 * a set, so that once a set reaches recap the reveal is a pure DISPLAY of stored
 * outcomes and never has to trigger or wait on resolution.
 *
 * Why this is needed: maybeResolveBattle only fires when EVERY set-team has an
 * ended attempt, and several paths reach recap without that ever being true —
 * a team that never started the challenge blocks it by design; an untimed battle
 * (challenges.timer_seconds is nullable) never auto-ends an open attempt; the
 * set-level total-timer expiry in /api/auto-submit flips play_state to recap
 * unconditionally; and a few direct ended_at closes in auto-submit bypass the
 * submit hook entirely. So "resolved by recap" has to be enforced here rather
 * than assumed.
 *
 * Deliberately bypasses maybeResolveBattle's all-teams-ended gate and calls
 * resolveBattle directly — the same thing the host's "Resolve now" fallback
 * does. Safe to call on an already-resolved battle: resolveBattle CAS-claims
 * battle_resolved_at first and returns { resolved: false } if the claim is lost,
 * so a battle already resolved by the auto-hook krijgt de bonus nooit twee keer.
 *
 * A battle with ZERO submissions from this set's teams is skipped, not resolved:
 * there is nothing to rank, so battle_resolved_at/battle_ranking stay NULL and
 * the reveal excludes it (the reveal reads battles WHERE battle_ranking IS NOT
 * NULL). Resolving it would award the whole ladder to teams that never played.
 *
 * Per-battle independent, so order doesn't matter here; reveal ordering (by
 * set_challenges.position) is stuk 3b's concern.
 */
export async function resolveBattlesForRecap(
	admin: AdminClient,
	setId: string
): Promise<{ resolved: string[]; skippedNoSubmissions: string[]; alreadyResolved: string[] }> {
	const resolved: string[] = [];
	const skippedNoSubmissions: string[] = [];
	const alreadyResolved: string[] = [];

	// Unresolved rows only — an already-resolved battle needs no work (and
	// resolveBattle's CAS would no-op on it anyway).
	const { data: scRows } = await admin
		.from('set_challenges')
		.select('challenge_id')
		.eq('set_id', setId)
		.is('battle_resolved_at', null);
	const candidateIds = (scRows ?? []).map((sc) => sc.challenge_id);
	if (candidateIds.length === 0) return { resolved, skippedNoSubmissions, alreadyResolved };

	// Keep only the battle-enabled ones, via the same parser the resolver, the
	// editor and the badge all use — the badge can never disagree with what
	// actually resolves.
	const { data: chs } = await admin
		.from('challenges')
		.select('id, points_config')
		.in('id', candidateIds);
	const battleIds = (chs ?? [])
		.filter((c) => parseBattleConfig(c.points_config).enabled)
		.map((c) => c.id);
	if (battleIds.length === 0) return { resolved, skippedNoSubmissions, alreadyResolved };

	const teams = await getTeamsInSet(admin, setId);
	const teamIds = teams.map((t) => t.id);
	if (teamIds.length === 0) {
		// No teams in the set — nothing could have been played or ranked.
		return { resolved, skippedNoSubmissions: battleIds, alreadyResolved };
	}

	for (const challengeId of battleIds) {
		// Set-scoped on purpose: count only submissions from THIS set's teams, so a
		// challenge reused by another set can't make an unplayed battle look played.
		const { count } = await admin
			.from('submissions')
			.select('*', { count: 'exact', head: true })
			.eq('challenge_id', challengeId)
			.in('team_id', teamIds);

		if (!count) {
			skippedNoSubmissions.push(challengeId);
			continue;
		}

		const result = await resolveBattle(admin, setId, challengeId);
		// Claim lost => something resolved it between our read and this call.
		if (result.resolved) resolved.push(challengeId);
		else alreadyResolved.push(challengeId);
	}

	return { resolved, skippedNoSubmissions, alreadyResolved };
}

/**
 * Auto-resolution hook, called at the end of scoreAndPersistSubmission for a
 * battle challenge once the submitting team's attempt has been ended. Resolves
 * only when EVERY set-team has an ended attempt on this challenge — the natural
 * "all teams finished" signal. Because the auto-submit backstop also ends
 * attempts (on timer expiry), this self-resolves when the last team's timer
 * runs out. A team that never started an attempt blocks this path on purpose;
 * the host "Resolve now" fallback (stuk 2) covers absentees.
 */
export async function maybeResolveBattle(
	admin: AdminClient,
	setId: string,
	challengeId: string
): Promise<void> {
	const teams = await getTeamsInSet(admin, setId);
	const teamIds = teams.map((t) => t.id);
	if (teamIds.length === 0) return;

	const { data: attempts } = await admin
		.from('challenge_attempts')
		.select('team_id, ended_at')
		.eq('challenge_id', challengeId)
		.in('team_id', teamIds);

	const endedTeamIds = new Set(
		(attempts ?? []).filter((a) => a.ended_at != null).map((a) => a.team_id)
	);
	// Every set-team must have an ENDED attempt (started + finished/auto-closed).
	const allDone = teamIds.every((id) => endedTeamIds.has(id));
	if (!allDone) return;

	await resolveBattle(admin, setId, challengeId);
}

// ─── Reveal phase (stuk 3b) ──────────────────────────────────────────────────

export type RevealableBattle = {
	challenge_id: string;
	position: number;
	title: string;
	/**
	 * The stored outcome, ordered best→worst — BattleRankEntry, NOT BattleEntry.
	 * BattleEntry ({teamId, score}) is resolveBattle's INPUT; what lands in
	 * set_challenges.battle_ranking is computeBattleRanking's OUTPUT
	 * ({team_id, rank, score, awarded}).
	 */
	battle_ranking: BattleRankEntry[];
};

/**
 * The battles a set's recap will reveal, in reveal order (set_challenges.position).
 *
 * "Revealable" = battle_ranking IS NOT NULL, which is exactly the set of battles
 * that actually resolved. Stuk 3a force-resolves every battle-with-submissions at
 * startRecap, so by recap time this is settled and stable: a zero-submission
 * battle (or one whose resolution failed) keeps battle_ranking NULL and is simply
 * excluded — een lege ranglijst onthullen is slechter dan hem overslaan.
 *
 * Deliberately NOT filtered on points_config.battle.enabled: battle_ranking is
 * only ever written by resolveBattle, so a non-empty ranking already proves the
 * challenge was battle-enabled when it resolved. Re-parsing the config here would
 * mean a host toggling battle OFF after resolution silently drops a battle the
 * teams already played and were scored on, mid-recap.
 *
 * Single source of truth for both the phase-entry decision (startRecap) and the
 * per-click advance (the recap reveal action) — the count must not drift between
 * the two, or the phase could end early and strand a battle unrevealed.
 */
export async function getRevealableBattles(
	admin: AdminClient,
	setId: string
): Promise<RevealableBattle[]> {
	const { data: scRows } = await admin
		.from('set_challenges')
		.select('challenge_id, position, battle_ranking')
		.eq('set_id', setId)
		.not('battle_ranking', 'is', null)
		.order('position');

	const rows = scRows ?? [];
	if (rows.length === 0) return [];

	const { data: chs } = await admin
		.from('challenges')
		.select('id, title')
		.in(
			'id',
			rows.map((r) => r.challenge_id)
		);
	const titleById = new Map((chs ?? []).map((c) => [c.id, c.title]));

	return rows.map((r) => ({
		challenge_id: r.challenge_id,
		position: r.position,
		title: titleById.get(r.challenge_id) ?? 'Battle',
		battle_ranking: (r.battle_ranking ?? []) as BattleRankEntry[]
	}));
}

/**
 * Everything the reveal SURFACES need (stuk 3c): the reveal-ordered battles plus
 * the teams map to resolve battle_ranking's team_ids into names/colours.
 *
 * Read-only over already-stored data — 3c displays what resolveBattle recorded,
 * it never re-ranks. Shared by the player waiting page and the TV podium so the
 * two can't disagree about which battles exist or in what order.
 *
 * Returns empty battles for a non-battle set, which is what makes both surfaces
 * degrade to the classic recap with no battle UI at all.
 */
export async function getBattleRevealData(
	admin: AdminClient,
	setId: string
): Promise<{
	battles: Array<{ challenge_id: string; title: string; ranking: BattleRankEntry[] }>;
	teams: Array<{ id: string; color: string; display_name: string }>;
}> {
	const battles = await getRevealableBattles(admin, setId);
	if (battles.length === 0) return { battles: [], teams: [] };

	const teams = await getTeamsInSet(admin, setId);
	return {
		battles: battles.map((b) => ({
			challenge_id: b.challenge_id,
			title: b.title,
			ranking: b.battle_ranking
		})),
		teams
	};
}
