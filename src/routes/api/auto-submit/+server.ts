import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.isAdmin) error(403, 'Forbidden');

	const db = createAdminClient();
	let created = 0;

	// ── Per-team challenge auto-close ──────────────────────────────────────────
	// Guarded but NOT an early return so the game-set check below always executes.
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

			// Load tabs for expired challenges, then their source tracks
			const { data: tabRows } = await db
				.from('challenge_tabs')
				.select('id, challenge_id, position')
				.in('challenge_id', expiredChallengeIds)
				.order('position');

			// We don't need source track data for empty auto-submit — just tab count
			const tabsByChallenge = new Map<string, { id: string; position: number }[]>();
			for (const tab of tabRows ?? []) {
				if (!tabsByChallenge.has(tab.challenge_id)) tabsByChallenge.set(tab.challenge_id, []);
				tabsByChallenge.get(tab.challenge_id)!.push({ id: tab.id, position: tab.position });
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
					// Build empty TabAnswer[] in new shape
					const tabs = tabsByChallenge.get(attempt.challenge_id) ?? [];
					const emptyAnswers = tabs.map((tab) => ({
						tab_position: tab.position,
						source_answers: []
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

				await db.from('challenge_attempts').update({ ended_at: endedAt }).eq('id', attempt.id);
			}
		}
	}

	// ── Game-set-level timer expiry ────────────────────────────────────────────
	// Always runs unconditionally — never gated by the challenge section above.
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
