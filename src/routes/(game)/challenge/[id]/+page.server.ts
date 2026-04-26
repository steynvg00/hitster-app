import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';

// Scoring rules (Normal variant):
//   Artist / Title: 5 pts each — exact match only (case-insensitive)
//   Year: 10 pts exact | 5 pts ±1 | 2 pts ±2 | 0 otherwise
function scoreSubmission(
	answers: { artist: string; title: string; year: number },
	track: { artist: string; title: string; year: number }
) {
	const breakdown = { artist: 0, title: 0, year: 0 };

	if (answers.artist.trim().toLowerCase() === track.artist.trim().toLowerCase()) {
		breakdown.artist = 5;
	}
	if (answers.title.trim().toLowerCase() === track.title.trim().toLowerCase()) {
		breakdown.title = 5;
	}

	const diff = Math.abs(answers.year - track.year);
	if (diff === 0) breakdown.year = 10;
	else if (diff === 1) breakdown.year = 5;
	else if (diff === 2) breakdown.year = 2;

	return { breakdown, total: breakdown.artist + breakdown.title + breakdown.year };
}

export const load: PageServerLoad = async ({ params, cookies, locals }) => {
	if (!locals.teamId) redirect(302, `/join?redirect=/challenge/${params.id}`);

	const supabase = createPublicClient(cookies);

	const { data: challenge, error: challengeErr } = await supabase
		.from('challenges')
		.select('*')
		.eq('id', params.id)
		.single();

	if (challengeErr || !challenge) error(404, 'Challenge not found');

	const { data: challengeTrack, error: ctErr } = await supabase
		.from('challenge_tracks')
		.select('*')
		.eq('challenge_id', params.id)
		.order('sort_order')
		.limit(1)
		.single();

	if (ctErr || !challengeTrack) error(500, 'Challenge has no tracks configured');

	const [trackResult, clipResult] = await Promise.all([
		supabase.from('tracks').select('*').eq('id', challengeTrack.track_id).single(),
		supabase.from('clips').select('*').eq('id', challengeTrack.clip_id).single()
	]);

	if (!trackResult.data || !clipResult.data) error(500, 'Track or clip data missing');

	const track = trackResult.data;
	const clip = clipResult.data;

	// Resolve clip URL: stored as a full https:// URL (placeholder) or a Supabase Storage path
	const clipUrl = clip.storage_path.startsWith('http')
		? clip.storage_path
		: supabase.storage.from('clips').getPublicUrl(clip.storage_path).data.publicUrl;

	const { data: answerOptions } = await supabase
		.from('answer_options')
		.select('*')
		.eq('challenge_id', params.id);

	const { data: team } = await supabase
		.from('teams')
		.select('*')
		.eq('id', locals.teamId)
		.single();

	if (!team) redirect(302, '/join');

	// Check if this team already submitted
	const { data: existing } = await supabase
		.from('submissions')
		.select('*')
		.eq('challenge_id', params.id)
		.eq('team_id', team.id)
		.maybeSingle();

	let priorResult: {
		score: number;
		breakdown: { artist: number; title: number; year: number };
		correct: { artist: string; title: string; year: number };
		answers: { artist: string; title: string; year: number };
	} | null = null;

	if (existing) {
		const ans = existing.answers as Record<string, string>;
		const { breakdown } = scoreSubmission(
			{ artist: ans.artist ?? '', title: ans.title ?? '', year: parseInt(ans.year ?? '0', 10) },
			track
		);
		priorResult = {
			score: existing.score ?? 0,
			breakdown,
			correct: { artist: track.artist, title: track.title, year: track.year },
			answers: { artist: ans.artist ?? '', title: ans.title ?? '', year: parseInt(ans.year ?? '0', 10) }
		};
	}

	return { challenge, track, clipUrl, answerOptions: answerOptions ?? [], team, priorResult };
};

export const actions: Actions = {
	default: async ({ request, params, cookies }) => {
		const supabase = createPublicClient(cookies);
		const admin = createAdminClient();

		const formData = await request.formData();
		const artist = (formData.get('artist') as string | null) ?? '';
		const title = (formData.get('title') as string | null) ?? '';
		const yearStr = formData.get('year') as string | null;
		const teamId = (formData.get('team_id') as string | null) ?? '';
		const year = parseInt(yearStr ?? '', 10);

		if (!artist || !title || isNaN(year) || !teamId) {
			return fail(400, { formError: 'All fields are required' });
		}

		// Fetch track for scoring (server-side — correct answers never sent to browser)
		const { data: ct } = await supabase
			.from('challenge_tracks')
			.select('track_id')
			.eq('challenge_id', params.id)
			.limit(1)
			.single();

		if (!ct) return fail(500, { formError: 'Challenge track not found' });

		const { data: track } = await supabase
			.from('tracks')
			.select('artist, title, year')
			.eq('id', ct.track_id)
			.single();

		if (!track) return fail(500, { formError: 'Track not found' });

		const { breakdown, total } = scoreSubmission({ artist, title, year }, track);

		const { error: subErr } = await supabase.from('submissions').insert({
			challenge_id: params.id,
			team_id: teamId,
			answers: { artist, title, year: year.toString() },
			score: total
		});

		if (subErr) {
			// Unique constraint: team already submitted this challenge
			if (subErr.code === '23505') {
				return fail(409, { formError: 'Already submitted — reload to see your result' });
			}
			return fail(500, { formError: subErr.message });
		}

		// Increment team score — uses admin client (bypasses RLS)
		const { data: teamRow } = await admin
			.from('teams')
			.select('score')
			.eq('id', teamId)
			.single();

		await admin
			.from('teams')
			.update({ score: (teamRow?.score ?? 0) + total })
			.eq('id', teamId);

		return {
			submitted: true,
			score: total,
			breakdown,
			correct: { artist: track.artist, title: track.title, year: track.year },
			answers: { artist, title, year }
		};
	}
};
