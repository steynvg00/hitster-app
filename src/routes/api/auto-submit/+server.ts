import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { scoreAndPersistSubmission } from '$lib/server/submit';

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

		// Timer effects (audit C1): time_boost/freeze/time_drain all extend or shrink
		// a team's deadline on a specific challenge. Every one is a payload-driven
		// marker row carrying { added_seconds, challenge_id } (freeze = +30, drain =
		// -15, boost = +30) inserted already-consumed (client-reaction markers), so
		// we match them by team + payload.challenge_id and SUM added_seconds — this
		// is the one place the server deadline moves, or these effects would be
		// purely cosmetic (the original time_boost/auto-submit bug this reuses the
		// exact same path to avoid reintroducing). Negative sums (drain) shorten the
		// deadline correctly; stacked drains/boosts just sum further.
		const boostMap = new Map<string, number>(); // `${team_id}|${challenge_id}` → net added seconds
		if (openAttempts?.length) {
			const { data: boostEffects } = await db
				.from('team_effects')
				.select('team_id, payload')
				.in('effect_type', ['time_boost', 'freeze', 'time_drain'])
				.in('team_id', [...new Set(openAttempts.map((a) => a.team_id))]);
			for (const e of boostEffects ?? []) {
				const p = (e.payload ?? {}) as { added_seconds?: number; challenge_id?: string };
				if (!p.challenge_id) continue;
				const key = `${e.team_id}|${p.challenge_id}`;
				boostMap.set(key, (boostMap.get(key) ?? 0) + (p.added_seconds ?? 0));
			}
		}

		// Grace window: only claim attempts expired MORE than GRACE_MS past their
		// (boost-adjusted) deadline. This gives a throttled/backgrounded phone (whose
		// timer interval was starved) a chance to wake, fire its own `remaining <= 0`
		// tick, and submit the REAL draft through the normal action first — the
		// backstop then finds an ended attempt and skips it. Also closes the
		// slow-client 409 race where the poll's insert would beat a client submit
		// landing at t=0.
		const GRACE_MS = 20_000;
		const expired = (openAttempts ?? []).filter((a) => {
			const seconds = timerMap.get(a.challenge_id) ?? 0;
			if (seconds <= 0) return false;
			const boost = boostMap.get(`${a.team_id}|${a.challenge_id}`) ?? 0;
			return new Date(a.started_at).getTime() + (seconds + boost) * 1000 + GRACE_MS < now;
		});

		if (expired.length > 0) {
			const expiredChallengeIds = [...new Set(expired.map((a) => a.challenge_id))];

			// Full challenge rows + tabs, so the backstop can run the SAME scoring
			// pipeline as the interactive submit (scoreAndPersistSubmission) on an
			// EMPTY draft — every field scores 0, but the insurance floor, streak
			// reset, effect consumption, crown, and powerup earning (incl.
			// penalty_shot) all run, instead of a hand-crafted score-0 row that
			// skipped them.
			const [challengesRes, tabsRes, setChRes] = await Promise.all([
				db.from('challenges').select('*').in('id', expiredChallengeIds),
				db
					.from('challenge_tabs')
					.select('*')
					.in('challenge_id', expiredChallengeIds)
					.order('position'),
				db
					.from('set_challenges')
					.select('challenge_id, set_id')
					.in('challenge_id', expiredChallengeIds)
			]);
			const challengeMap = new Map((challengesRes.data ?? []).map((c) => [c.id, c]));
			const tabsByChallenge = new Map<string, typeof tabsRes.data>();
			for (const tab of tabsRes.data ?? []) {
				const list = tabsByChallenge.get(tab.challenge_id) ?? [];
				list.push(tab);
				tabsByChallenge.set(tab.challenge_id, list);
			}

			// Resolve each expired challenge's active playing set (for effects /
			// crown / earning). A challenge can sit in several sets; take the one
			// that's actually being played right now.
			const scRows = setChRes.data ?? [];
			const setIds = [...new Set(scRows.map((r) => r.set_id))];
			const { data: playingSets } = setIds.length
				? await db
						.from('game_sets')
						.select('id')
						.in('id', setIds)
						.eq('status', 'active')
						.eq('play_state', 'playing')
				: { data: [] as { id: string }[] };
			const playingSetIds = new Set((playingSets ?? []).map((s) => s.id));
			const challengeSetMap = new Map<string, string>();
			for (const r of scRows) {
				if (playingSetIds.has(r.set_id) && !challengeSetMap.has(r.challenge_id)) {
					challengeSetMap.set(r.challenge_id, r.set_id);
				}
			}

			const endedAt = new Date().toISOString();

			for (const attempt of expired) {
				const { data: existingSub } = await db
					.from('submissions')
					.select('id')
					.eq('challenge_id', attempt.challenge_id)
					.eq('team_id', attempt.team_id)
					.maybeSingle();
				if (existingSub) {
					// The team already submitted (client beat the backstop) — just
					// make sure the attempt is closed.
					await db.from('challenge_attempts').update({ ended_at: endedAt }).eq('id', attempt.id);
					continue;
				}

				const challenge = challengeMap.get(attempt.challenge_id);
				const challengeTabs = tabsByChallenge.get(attempt.challenge_id) ?? [];
				if (!challenge || !challengeTabs.length) {
					// Can't score without a challenge + tabs — close the attempt so it
					// doesn't get re-polled forever.
					await db.from('challenge_attempts').update({ ended_at: endedAt }).eq('id', attempt.id);
					continue;
				}

				const elapsedSeconds = Math.floor((now - new Date(attempt.started_at).getTime()) / 1000);
				const outcome = await scoreAndPersistSubmission(db, {
					challenge,
					tabs: challengeTabs,
					teamId: attempt.team_id,
					playerSetId: challengeSetMap.get(attempt.challenge_id) ?? null,
					draftByTab: {}, // empty → every field scores 0 (partial scoring handles it)
					elapsedSeconds
				});

				if (outcome.ok) {
					created++;
				} else {
					// 23505 (a client submission landed in the race) or an error — the
					// helper only ends the attempt on success, so close it here.
					await db.from('challenge_attempts').update({ ended_at: endedAt }).eq('id', attempt.id);
				}
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
