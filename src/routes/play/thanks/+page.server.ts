import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';
import { TEAM_COLOR_ORDER } from '$lib/server/randomize';

export const load: PageServerLoad = async ({ locals, cookies, url }) => {
	if (!locals.teamId) redirect(302, '/join');

	const setId = url.searchParams.get('set_id');
	if (!setId) redirect(302, '/');

	const supabase = createPublicClient(cookies);
	const admin = createAdminClient();

	const [{ data: team }, { data: gameSet }] = await Promise.all([
		supabase.from('teams').select('id, color, display_name').eq('id', locals.teamId).maybeSingle(),
		admin
			.from('game_sets')
			.select('id, name, status, recap_state, ended_at, team_count')
			.eq('id', setId)
			.maybeSingle()
	]);

	if (!team) redirect(302, '/join');
	if (!gameSet || !gameSet.ended_at) redirect(302, '/team');

	// Load challenges in this set with this team's scores
	const { data: setChallenges } = await admin
		.from('set_challenges')
		.select('challenge_id, position')
		.eq('set_id', setId)
		.order('position');

	const challengeIds = (setChallenges ?? []).map((sc) => sc.challenge_id);

	let challengeResults: {
		title: string;
		variant: string;
		score: number | null;
		maxScore: number;
	}[] = [];

	if (challengeIds.length > 0) {
		const [{ data: challenges }, { data: subs }] = await Promise.all([
			admin.from('challenges').select('id, title, variant').in('id', challengeIds),
			supabase
				.from('submissions')
				.select('challenge_id, score')
				.in('challenge_id', challengeIds)
				.eq('team_id', locals.teamId)
				.eq('is_final', true)
		]);

		const submissionMap = new Map((subs ?? []).map((s) => [s.challenge_id, s.score]));
		const challengeMap = new Map((challenges ?? []).map((c) => [c.id, c]));

		challengeResults = (setChallenges ?? [])
			.map((sc) => {
				const c = challengeMap.get(sc.challenge_id);
				if (!c) return null;
				return {
					title: c.title,
					variant: c.variant,
					score: submissionMap.get(sc.challenge_id) ?? null,
					maxScore: 0 // Not critical for thanks screen
				};
			})
			.filter((r): r is NonNullable<typeof r> => r != null);
	}

	// ── Eindplek in deze set (fase 5, scherm 11H) ─────────────────────────────
	// Zelfde aggregatie als het wachtscherm: de setscore van elk team is de som
	// van zijn definitieve submissions op de challenges van deze set. Puur
	// afgeleid uit bestaande rijen — er wordt niets geschreven en er komt geen
	// nieuwe kolom aan te pas.
	const scopedColors = TEAM_COLOR_ORDER.slice(0, gameSet.team_count ?? 6);
	const [{ data: scopedTeams }, { data: allSubs }] = await Promise.all([
		admin.from('teams').select('id').in('color', scopedColors),
		challengeIds.length
			? supabase
					.from('submissions')
					.select('team_id, score')
					.in('challenge_id', challengeIds)
					.eq('is_final', true)
			: Promise.resolve({ data: [] as { team_id: string | null; score: number | null }[] })
	]);

	const setScores = new Map<string, number>();
	for (const t of scopedTeams ?? []) setScores.set(t.id, 0);
	for (const sub of allSubs ?? []) {
		if (sub.team_id && setScores.has(sub.team_id)) {
			setScores.set(sub.team_id, (setScores.get(sub.team_id) ?? 0) + (sub.score ?? 0));
		}
	}

	// Aflopend: index 0 = plek 1. Voedt zowel de eindplek als de achterstandsregel.
	const descendingScores = [...setScores.values()].sort((a, b) => b - a);
	const totalTeams = descendingScores.length;
	const teamSetScore = setScores.get(locals.teamId) ?? 0;
	// Gedeelde scores krijgen dezelfde plek — "hoeveel teams staan strikt boven
	// ons" + 1. Twee teams op 900 zijn dus allebei plek 1, en het volgende team
	// is plek 3, net als op het leaderboard.
	const place = descendingScores.filter((s) => s > teamSetScore).length + 1;

	// Teamgenoten voor de initialenrij op de eindstandkaart.
	const { data: teammates } = await admin
		.from('players')
		.select('id, display_name')
		.eq('set_id', setId)
		.eq('team_id', locals.teamId);

	// Load player info if available
	let playerName: string | null = null;
	if (locals.playerId) {
		const { data: player } = await admin
			.from('players')
			.select('display_name')
			.eq('id', locals.playerId)
			.maybeSingle();
		playerName = player?.display_name ?? null;
	}

	const totalScore = challengeResults.reduce((s, r) => s + (r.score ?? 0), 0);

	return {
		team,
		setName: gameSet.name,
		setId,
		playerName,
		challengeResults,
		totalScore,
		place,
		totalTeams,
		teamSetScore,
		descendingScores,
		teammates: teammates ?? []
	};
};
