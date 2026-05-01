import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.isAdmin) error(403, 'Forbidden');

	const db = createAdminClient();

	// Find all active challenges that have a timer running
	const { data: activeChallenges } = await db
		.from('challenges')
		.select('id, timer_seconds, started_at')
		.eq('status', 'active')
		.not('started_at', 'is', null);

	if (!activeChallenges?.length) return json({ created: 0 });

	const now = Date.now();
	const expired = activeChallenges.filter((ch) => {
		const endsAt = new Date(ch.started_at!).getTime() + ch.timer_seconds * 1000;
		return endsAt < now;
	});

	if (!expired.length) return json({ created: 0 });

	const [teamsResult] = await Promise.all([db.from('teams').select('id')]);
	const teams = teamsResult.data ?? [];

	let created = 0;

	for (const ch of expired) {
		// Get existing submissions for this challenge
		const { data: existingSubs } = await db
			.from('submissions')
			.select('team_id')
			.eq('challenge_id', ch.id);

		const submittedTeamIds = new Set((existingSubs ?? []).map((s) => s.team_id));
		const missingTeams = teams.filter((t) => !submittedTeamIds.has(t.id));

		if (missingTeams.length > 0) {
			// Get challenge tracks for the empty answers shape
			const { data: cts } = await db
				.from('challenge_tracks')
				.select('track_id, sort_order')
				.eq('challenge_id', ch.id)
				.order('sort_order');

			const emptyAnswers = (cts ?? []).map((ct) => ({
				track_id: ct.track_id,
				field_values: {},
				scored: {},
				total: 0
			}));

			for (const team of missingTeams) {
				const { error: insertErr } = await db.from('submissions').insert({
					challenge_id: ch.id,
					team_id: team.id,
					answers: emptyAnswers as never,
					score: 0,
					status: 'auto_wrong',
					is_final: true
				});
				if (!insertErr) created++;
			}
		}

		// Expired challenge → mark completed (all teams now have final submissions)
		await db.from('challenges').update({ status: 'completed', is_active: false }).eq('id', ch.id);
	}

	return json({ created });
};
