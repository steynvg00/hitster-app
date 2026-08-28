import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';
import { parseBattleConfig } from '$lib/battle-ranking';
import { resolveBattle } from '$lib/server/battle';
import {
	adjustTeamScore,
	grantExtraTime,
	grantPowerup,
	resetTeamChallenge,
	type HostActor
} from '$lib/server/host-tools';

// Battle mode (stuk 2) turnout shape — module-scoped so BOTH the early-return
// (no active sets) and main load() branches agree on the type; otherwise
// TypeScript infers Record<string, BattleStatus> | {} and the {} half has no
// index signature for the .svelte template's data.battleStatus[challenge.id].
type BattleRankEntry = {
	team_id: string;
	rank: number;
	score: number;
	awarded: number;
};
type BattleStatus = {
	resolved: boolean;
	ranking: BattleRankEntry[] | null;
	outstandingTeamIds: string[];
	hasSubmission: boolean;
};

// The powerup catalog as the host-tools sheet needs it: enough to render the
// picker AND to say, before the confirm step, what granting this type will do.
// Module-scoped for the same reason as BattleStatus above — the no-active-sets
// early return and the main branch must agree on the type.
type PowerupTypeOption = {
	id: string;
	name: string;
	icon: string | null;
	category: string | null;
	immediate_use: boolean;
	holdable: boolean;
};

export const load: PageServerLoad = async ({ url }) => {
	const db = createAdminClient();

	// Find active sets that have at least one player joined
	const { data: activeSets } = await db
		.from('game_sets')
		.select(
			'id, name, team_count, play_state, total_timer_seconds, started_at, scores_hidden, crown_holder_team_id'
		)
		.eq('status', 'active');

	const setsWithPlayers: Array<{
		id: string;
		name: string;
		team_count: number;
		play_state: 'joining' | 'playing' | 'recap';
		total_timer_seconds: number | null;
		started_at: string | null;
		scores_hidden: boolean;
		crown_holder_team_id: string | null;
		player_count: number;
	}> = [];

	await Promise.all(
		(activeSets ?? []).map(async (set) => {
			const { count } = await db
				.from('players')
				.select('*', { count: 'exact', head: true })
				.eq('set_id', set.id);
			if ((count ?? 0) > 0) {
				setsWithPlayers.push({
					...set,
					play_state: (set.play_state ?? 'joining') as 'joining' | 'playing' | 'recap',
					scores_hidden: (set as unknown as { scores_hidden?: boolean }).scores_hidden ?? false,
					crown_holder_team_id:
						(set as unknown as { crown_holder_team_id?: string | null }).crown_holder_team_id ??
						null,
					player_count: count!
				});
			}
		})
	);

	if (setsWithPlayers.length === 0) {
		return {
			activeSets: setsWithPlayers,
			selectedSetId: null,
			selectedSet: null,
			teams: [],
			players: [],
			challenges: [],
			attempts: [],
			submissions: [],
			activity: [],
			teamPowerups: [],
			powerupTypes: [] as PowerupTypeOption[],
			battleStatus: {} as Record<string, BattleStatus>
		};
	}

	// Determine selected set from URL param (fall back to first)
	const paramSetId = url.searchParams.get('set');
	const validSet = setsWithPlayers.find((s) => s.id === paramSetId);
	const selectedSetId = validSet ? paramSetId! : setsWithPlayers[0].id;
	const selectedSet = validSet ?? setsWithPlayers[0];

	// Load teams scoped to this set's team_count
	const scopedColors = TEAM_COLOR_ORDER.slice(0, selectedSet.team_count);

	const [{ data: teamRows }, { data: playerRows }, { data: setChallengeRows }] = await Promise.all([
		db.from('teams').select('id, color, display_name, score').in('color', scopedColors),
		db.from('players').select('id, display_name, photo_url, team_id').eq('set_id', selectedSetId),
		db
			.from('set_challenges')
			.select('id, challenge_id, position, battle_resolved_at, battle_ranking')
			.eq('set_id', selectedSetId)
			.order('position')
	]);

	const teams = (teamRows ?? []).sort(
		(a, b) =>
			TEAM_COLOR_ORDER.indexOf(a.color as (typeof TEAM_COLOR_ORDER)[number]) -
			TEAM_COLOR_ORDER.indexOf(b.color as (typeof TEAM_COLOR_ORDER)[number])
	);

	const challengeIds = (setChallengeRows ?? []).map((sc) => sc.challenge_id);
	const positionMap = new Map((setChallengeRows ?? []).map((sc) => [sc.challenge_id, sc.position]));

	const [challengeResult, attemptsResult, subsResult, activityResult, teamPowerupsResult] =
		await Promise.all([
			challengeIds.length
				? db
						.from('challenges')
						.select('id, title, variant, timer_seconds, stage_label, status, points_config')
						.in('id', challengeIds)
				: { data: [] as never[] },
			challengeIds.length
				? db.from('challenge_attempts').select('*').in('challenge_id', challengeIds)
				: { data: [] as never[] },
			challengeIds.length
				? db
						.from('submissions')
						.select('team_id, challenge_id, score, status, is_final, answers')
						.in('challenge_id', challengeIds)
				: { data: [] as never[] },
			teams.length
				? db
						.from('activity_log')
						.select('*')
						.in(
							'team_id',
							teams.map((t) => t.id)
						)
						.order('created_at', { ascending: false })
						.limit(30)
				: { data: [] as never[] },
			teams.length
				? db
						.from('team_powerups')
						.select('id, team_id, status, powerup_types(id, name, icon)')
						.in(
							'team_id',
							teams.map((t) => t.id)
						)
						.eq('set_id', selectedSetId)
						// 'active' isn't in this branch's team_powerups status CHECK yet
						// (P3b activation, migration 0047, not merged here) — the hand-
						// maintained database.ts type reflects that. Query forward-
						// compatibly for when it lands; cast past the stale union.
						.in('status', ['held', 'active'] as unknown as ('pending' | 'held' | 'used' | 'lost')[])
				: { data: [] as never[] }
		]);

	// Powerup catalog for the host-tools sheet. coming_soon types are excluded:
	// granting one would write a row that no activation branch can act on.
	const { data: powerupTypeRows } = await db
		.from('powerup_types')
		.select('id, name, icon, category, immediate_use, holdable, coming_soon')
		.eq('coming_soon', false)
		.order('sort_order');
	const powerupTypes: PowerupTypeOption[] = (powerupTypeRows ?? []).map((t) => ({
		id: t.id,
		name: t.name,
		icon: t.icon,
		category: t.category,
		immediate_use: t.immediate_use,
		holdable: t.holdable
	}));

	// Sort challenges by their position in the set
	const challenges = (challengeResult.data ?? []).sort(
		(a, b) => (positionMap.get(a.id) ?? 0) - (positionMap.get(b.id) ?? 0)
	);

	const teamPowerups = (
		(teamPowerupsResult.data ?? []) as unknown as Array<{
			id: string;
			team_id: string;
			status: 'pending' | 'held' | 'used' | 'lost' | 'active' | 'consumed';
			powerup_types: { id: string; name: string; icon: string | null } | null;
		}>
	).map((row) => ({
		id: row.id,
		team_id: row.team_id,
		status: row.status,
		powerup_types: row.powerup_types
	}));

	// Battle mode (stuk 2): per-battle-challenge turnout, for the "Resolve now"
	// host fallback (absentee teams block the auto-hook in scoreAndPersistSubmission
	// on purpose — this is where the host steps in). Same parseBattleConfig the
	// editor + resolveBattle read, so this can never drift from what's configured.
	const setChallengeByChallenge = new Map(
		(setChallengeRows ?? []).map((sc) => [sc.challenge_id, sc])
	);
	const teamIds = teams.map((t) => t.id);
	const battleStatus: Record<string, BattleStatus> = {};
	for (const ch of challenges) {
		const { enabled } = parseBattleConfig((ch as { points_config?: unknown }).points_config);
		if (!enabled) continue;
		const sc = setChallengeByChallenge.get(ch.id) as
			| { battle_resolved_at?: string | null; battle_ranking?: unknown }
			| undefined;
		const finishedTeamIds = new Set(
			(attemptsResult.data ?? [])
				.filter((a) => a.challenge_id === ch.id && a.ended_at != null)
				.map((a) => a.team_id)
		);
		battleStatus[ch.id] = {
			resolved: sc?.battle_resolved_at != null,
			ranking: (sc?.battle_ranking as BattleRankEntry[] | null) ?? null,
			outstandingTeamIds: teamIds.filter((id) => !finishedTeamIds.has(id)),
			hasSubmission: (subsResult.data ?? []).some((s) => s.challenge_id === ch.id)
		};
	}

	return {
		activeSets: setsWithPlayers,
		selectedSetId,
		selectedSet,
		teams,
		players: playerRows ?? [],
		challenges,
		attempts: attemptsResult.data ?? [],
		submissions: subsResult.data ?? [],
		activity: activityResult.data ?? [],
		teamPowerups,
		powerupTypes,
		battleStatus
	};
};

/**
 * Wie de ingreep doet. Uit de ingelogde host-sessie, niet uit het formulier —
 * een client mag nooit kunnen kiezen wiens naam er in het log komt.
 *
 * Deze route valt onder de /admin-layoutguard, dus locals.user is hier gevuld.
 * De fallback bestaat alleen voor de dev-sessie zonder Supabase-login.
 */
function actorOf(locals: App.Locals): HostActor {
	return { id: locals.user?.id ?? null, email: locals.user?.email ?? null };
}

export const actions: Actions = {
	toggleScoresHidden: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const setId = data.get('set_id') as string;
		if (!setId) return fail(400, { error: 'Missing set_id' });

		const { data: gs } = await db
			.from('game_sets')
			.select('scores_hidden')
			.eq('id', setId)
			.maybeSingle();
		if (!gs) return fail(404, { error: 'Set not found' });

		await db
			.from('game_sets')
			.update({ scores_hidden: !(gs as unknown as { scores_hidden?: boolean }).scores_hidden })
			.eq('id', setId);
		return { success: true };
	},

	// ── Host-ingrepen ─────────────────────────────────────────────────────────
	//
	// Vier dunne wrappers om $lib/server/host-tools. De logica staat daar zodat
	// hij zonder database te controleren is (tests/bots/verify-host-tools.ts);
	// hier blijft alleen over wat een action moet doen: formulier lezen, de
	// ingelogde host als `actor` meegeven, en de uitkomst als bericht teruggeven.
	//
	// De reden is bij alle vier verplicht en wordt in host-tools afgedwongen, niet
	// hier — dan kan één van de vier hem niet stilletjes overslaan.

	adjustScore: async ({ request, locals }) => {
		const db = createAdminClient();
		const fd = await request.formData();
		const teamId = fd.get('team_id') as string;
		const setId = (fd.get('set_id') as string | null) || null;
		const delta = Number.parseInt(fd.get('delta') as string, 10);
		const reason = (fd.get('reason') as string) ?? '';
		if (!teamId) return fail(400, { error: 'Missing team_id' });

		const res = await adjustTeamScore(db, { teamId, setId, delta, reason, actor: actorOf(locals) });
		if (!res.ok) return fail(400, { error: res.error });
		const teken = res.newScore - res.oldScore >= 0 ? '+' : '';
		return {
			success: true,
			message:
				`Score bijgewerkt: ${res.oldScore} → ${res.newScore} (${teken}${res.newScore - res.oldScore})` +
				(res.clamped ? ' — geklemd op 0, want lager kan een score in dit spel niet.' : '')
		};
	},

	grantPowerup: async ({ request, locals }) => {
		const db = createAdminClient();
		const fd = await request.formData();
		const teamId = fd.get('team_id') as string;
		const setId = fd.get('set_id') as string;
		const typeId = fd.get('powerup_type_id') as string;
		const reason = (fd.get('reason') as string) ?? '';
		if (!teamId || !setId || !typeId) {
			return fail(400, { error: 'Missing team_id, set_id or powerup_type_id' });
		}

		const res = await grantPowerup(db, { teamId, setId, typeId, reason, actor: actorOf(locals) });
		if (!res.ok) return fail(400, { error: res.error });
		return {
			success: true,
			message:
				res.gedrag === 'in_voorraad'
					? 'Powerup staat in de voorraad van het team.'
					: res.activated
						? 'Powerup is direct afgegaan.'
						: 'Powerup toegekend, maar de activatie is niet gelukt — zie de activity log.'
		};
	},

	grantExtraTime: async ({ request, locals }) => {
		const db = createAdminClient();
		const fd = await request.formData();
		const teamId = fd.get('team_id') as string;
		const setId = (fd.get('set_id') as string | null) || null;
		const challengeId = fd.get('challenge_id') as string;
		const seconds = Number.parseInt(fd.get('seconds') as string, 10);
		const reason = (fd.get('reason') as string) ?? '';
		if (!teamId || !challengeId) return fail(400, { error: 'Missing team_id or challenge_id' });

		const res = await grantExtraTime(db, {
			teamId,
			setId,
			challengeId,
			seconds,
			reason,
			actor: actorOf(locals)
		});
		if (!res.ok) return fail(400, { error: res.error });
		return { success: true, message: `+${res.seconds}s — staat al op de telefoon van het team.` };
	},

	resetTeamAttempt: async ({ request, locals }) => {
		const db = createAdminClient();
		const fd = await request.formData();
		const teamId = fd.get('team_id') as string;
		const setId = (fd.get('set_id') as string | null) || null;
		const challengeId = fd.get('challenge_id') as string;
		const reason = (fd.get('reason') as string) ?? '';
		if (!teamId || !challengeId) return fail(400, { error: 'Missing team_id or challenge_id' });

		const res = await resetTeamChallenge(db, {
			teamId,
			setId,
			challengeId,
			reason,
			actor: actorOf(locals)
		});
		if (!res.ok) return fail(400, { error: res.error });
		return {
			success: true,
			message:
				`Teruggezet: −${res.pointsDeducted} punten (${res.oldScore} → ${res.newScore}), ` +
				`${res.submissionsDeleted} inlevering(en) weg` +
				(res.powerupsRevoked > 0
					? `, ${res.powerupsRevoked} ongebruikte powerup(s) ingetrokken`
					: '') +
				'.'
		};
	},

	// Battle mode (stuk 2): the host's absentee fallback. The auto-hook in
	// scoreAndPersistSubmission only resolves once EVERY set-team has an ended
	// attempt — a team that never scanned the challenge blocks it on purpose. This
	// is the real, host-auth-gated production action (this route is under the
	// /admin layout guard) calling the SAME resolveBattle the auto-hook and the
	// dev-only /api/dev/battle-resolve harness endpoint both use — one engine,
	// three callers.
	resolveBattleNow: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const setId = data.get('set_id') as string | null;
		const challengeId = data.get('challenge_id') as string | null;
		if (!setId || !challengeId) return fail(400, { error: 'Missing set_id or challenge_id' });

		const { data: ch } = await db
			.from('challenges')
			.select('points_config')
			.eq('id', challengeId)
			.maybeSingle();
		const { enabled } = parseBattleConfig(ch?.points_config);
		if (!enabled) return fail(400, { error: 'Not a battle challenge' });

		const { data: sc } = await db
			.from('set_challenges')
			.select('battle_resolved_at')
			.eq('set_id', setId)
			.eq('challenge_id', challengeId)
			.maybeSingle();
		if ((sc as { battle_resolved_at?: string | null } | null)?.battle_resolved_at) {
			return fail(400, { error: 'Already resolved' });
		}

		const { count } = await db
			.from('submissions')
			.select('*', { count: 'exact', head: true })
			.eq('challenge_id', challengeId);
		if (!count) return fail(400, { error: 'No submissions yet — nothing to resolve' });

		const result = await resolveBattle(db, setId, challengeId);
		if (!result.resolved) return fail(409, { error: 'Resolution was already claimed' });
		return { success: true, action: 'resolveBattleNow' };
	}
};
