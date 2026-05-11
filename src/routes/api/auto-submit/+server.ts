import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.isAdmin) error(403, 'Forbidden');

	const db = createAdminClient();
	let created = 0;

	// ── Per-team challenge auto-close ──────────────────────────────────────────
	// Only runs when timed challenges exist — guarded but NOT an early return so
	// the game-set-level check below always executes.
	const { data: challenges } = await db
		.from('challenges')
		.select('id, timer_seconds')
		.gt('timer_seconds', 0);

	if (challenges?.length) {
		const timerMap = new Map(challenges.map((c) => [c.id, c.timer_seconds]));
		const challengeIds = challenges.map((c) => c.id);

		const { data: openAttempts } = await db
			.from('challenge_attempts')
			.select('id, challenge_id, team_id, started_at')
			.in('challenge_id', challengeIds)
			.is('ended_at', null);

		const now = Date.now();
		const expired = (openAttempts ?? []).filter((a) => {
			const seconds = timerMap.get(a.challenge_id) ?? 0;
			return seconds > 0 && new Date(a.started_at).getTime() + seconds * 1000 < now;
		});

		if (expired.length > 0) {
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

			const endedAt = new Date().toISOString();

			for (const attempt of expired) {
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

				await db
					.from('challenge_attempts')
					.update({ ended_at: endedAt })
					.eq('id', attempt.id);
			}
		}
	}

	// ── Game-set-level timer expiry ────────────────────────────────────────────
	// Always runs, independent of whether any challenge attempts were expired.
	// This was previously unreachable when challenges had no timers (early return bug).
	const { data: activeSets } = await db
		.from('game_sets')
		.select('id, total_timer_seconds, started_at')
		.eq('status', 'active')
		.eq('play_state', 'playing')
		.not('total_timer_seconds', 'is', null)
		.not('started_at', 'is', null);

	const nowMs = Date.now();
	for (const set of activeSets ?? []) {
		if (!set.total_timer_seconds || !set.started_at) continue;
		const endsAt = new Date(set.started_at).getTime() + set.total_timer_seconds * 1000;
		if (nowMs >= endsAt) {
			await db
				.from('game_sets')
				.update({ play_state: 'recap', ended_at: new Date().toISOString() })
				.eq('id', set.id);
		}
	}

	return json({ created });
};
