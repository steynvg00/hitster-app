import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.isAdmin) error(403, 'Forbidden');

	const db = createAdminClient();

	// Build a map of timer_seconds per challenge (only timed challenges matter)
	const { data: challenges } = await db
		.from('challenges')
		.select('id, timer_seconds')
		.gt('timer_seconds', 0);

	if (!challenges?.length) return json({ created: 0 });

	const timerMap = new Map(challenges.map((c) => [c.id, c.timer_seconds]));
	const challengeIds = challenges.map((c) => c.id);

	// Find all open attempts (ended_at IS NULL) for timed challenges
	const { data: openAttempts } = await db
		.from('challenge_attempts')
		.select('id, challenge_id, team_id, started_at')
		.in('challenge_id', challengeIds)
		.is('ended_at', null);

	if (!openAttempts?.length) return json({ created: 0 });

	const now = Date.now();
	const expired = openAttempts.filter((a) => {
		const seconds = timerMap.get(a.challenge_id) ?? 0;
		return seconds > 0 && new Date(a.started_at).getTime() + seconds * 1000 < now;
	});

	if (!expired.length) return json({ created: 0 });

	// Pre-fetch challenge tracks for all affected challenges (one query)
	const expiredChallengeIds = [...new Set(expired.map((a) => a.challenge_id))];
	const { data: allCts } = await db
		.from('challenge_tracks')
		.select('challenge_id, track_id, sort_order')
		.in('challenge_id', expiredChallengeIds)
		.order('sort_order');

	const ctsByChallenge = new Map<string, { track_id: string; sort_order: number }[]>();
	for (const ct of allCts ?? []) {
		if (!ctsByChallenge.has(ct.challenge_id)) ctsByChallenge.set(ct.challenge_id, []);
		ctsByChallenge.get(ct.challenge_id)!.push(ct);
	}

	let created = 0;
	const endedAt = new Date().toISOString();

	for (const attempt of expired) {
		// Skip if a submission already exists (player submitted just before poll)
		const { data: existingSub } = await db
			.from('submissions')
			.select('id')
			.eq('challenge_id', attempt.challenge_id)
			.eq('team_id', attempt.team_id)
			.maybeSingle();

		if (!existingSub) {
			const cts = ctsByChallenge.get(attempt.challenge_id) ?? [];
			const emptyAnswers = cts.map((ct) => ({
				track_id: ct.track_id,
				field_values: {},
				scored: {},
				total: 0
			}));

			const { error: insertErr } = await db.from('submissions').insert({
				challenge_id: attempt.challenge_id,
				team_id: attempt.team_id,
				answers: emptyAnswers as never,
				score: 0,
				status: 'auto_wrong',
				is_final: true
			});
			if (!insertErr) created++;
		}

		// Mark the attempt ended regardless (submission may have already existed)
		await db
			.from('challenge_attempts')
			.update({ ended_at: endedAt })
			.eq('id', attempt.id);
	}

	return json({ created });
};
