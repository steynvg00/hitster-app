import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async () => {
	const db = createAdminClient();

	// Load unresolved review requests with related data
	const { data: requests, error } = await db
		.from('review_requests')
		.select('*')
		.eq('resolved', false)
		.order('created_at', { ascending: true });

	if (error || !requests) {
		return { requests: [], loadError: error?.message ?? 'Unknown error' };
	}

	if (requests.length === 0) return { requests: [], loadError: null };

	// Hydrate with submission + team + challenge data
	const submissionIds = [...new Set(requests.map((r) => r.submission_id))];
	const { data: submissions } = await db
		.from('submissions')
		.select('id, team_id, challenge_id, answers, score, status')
		.in('id', submissionIds);

	const teamIds = [...new Set((submissions ?? []).map((s) => s.team_id))];
	const challengeIds = [...new Set((submissions ?? []).map((s) => s.challenge_id))];

	const [teamsResult, challengesResult] = await Promise.all([
		db.from('teams').select('id, display_name, color').in('id', teamIds),
		db.from('challenges').select('id, title, variant, points_config').in('id', challengeIds)
	]);

	// Build lookup maps
	const subMap = new Map((submissions ?? []).map((s) => [s.id, s]));
	const teamMap = new Map((teamsResult.data ?? []).map((t) => [t.id, t]));
	const challengeMap = new Map((challengesResult.data ?? []).map((c) => [c.id, c]));

	const enriched = requests.map((rr) => {
		const sub = subMap.get(rr.submission_id);
		const team = sub ? teamMap.get(sub.team_id) : null;
		const challenge = sub ? challengeMap.get(sub.challenge_id) : null;
		const answers = (sub?.answers ?? {}) as Record<string, string>;
		const submitted = answers[rr.field_name] ?? '—';

		// Derive the correct answer from the challenge's variant
		// (we don't re-fetch the track here — host sees team's answer + field name)
		return {
			...rr,
			teamName: team?.display_name ?? 'Unknown team',
			teamColor: team?.color ?? 'black',
			challengeTitle: challenge?.title ?? 'Unknown challenge',
			submitted,
			currentScore: sub?.score ?? 0,
			submissionStatus: sub?.status ?? 'auto_wrong'
		};
	});

	return { requests: enriched, loadError: null };
};

export const actions: Actions = {
	approve: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();

		const requestId = data.get('request_id') as string;
		const submissionId = data.get('submission_id') as string;
		const fieldName = data.get('field_name') as string;
		const awardPointsStr = data.get('award_points') as string;
		const awardPoints = parseInt(awardPointsStr, 10) || 0;

		if (!requestId || !submissionId) return fail(400, { error: 'Missing ids' });

		// Fetch current submission
		const { data: sub } = await db
			.from('submissions')
			.select('score, team_id, answers, challenge_id')
			.eq('id', submissionId)
			.single();
		if (!sub) return fail(404, { error: 'Submission not found' });

		const newScore = (sub.score ?? 0) + awardPoints;

		// Update submission
		await db.from('submissions').update({
			score: newScore,
			status: 'review_approved'
		}).eq('id', submissionId);

		// Add points to team
		if (awardPoints > 0) {
			const { data: team } = await db.from('teams').select('score').eq('id', sub.team_id).single();
			await db.from('teams')
				.update({ score: (team?.score ?? 0) + awardPoints })
				.eq('id', sub.team_id);
		}

		// Mark request resolved
		await db.from('review_requests').update({ resolved: true }).eq('id', requestId);

		// Log to activity_log
		await db.from('activity_log').insert({
			event_type: 'review_approved',
			team_id: sub.team_id,
			challenge_id: sub.challenge_id,
			payload: { field_name: fieldName, award_points: awardPoints, submission_id: submissionId }
		});

		return { success: true };
	},

	reject: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();

		const requestId = data.get('request_id') as string;
		const submissionId = data.get('submission_id') as string;

		if (!requestId || !submissionId) return fail(400, { error: 'Missing ids' });

		await Promise.all([
			db.from('review_requests').update({ resolved: true }).eq('id', requestId),
			db.from('submissions').update({ status: 'review_rejected' }).eq('id', submissionId)
		]);

		return { success: true };
	}
};
