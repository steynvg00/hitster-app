import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { VARIANTS } from '$lib/variants';

const DEFAULT_POINTS: Record<string, object> = {
	normal: { artist: 5, title: 5, year: { exact: 10, off1: 5, off2: 2 } },
	label: { label: 10 },
	anthem: { festival: 5, artist: 5, title: 5, year: { exact: 10, off1: 5, off2: 2 } },
	vocal: { vocal_source: 15 },
	fragments: { correct_order: 20 },
	kick: { per_correct: 5 },
	mashup: { per_correct: 5 },
	battle: { winner: 20, closest: 10 }
};

export const load: PageServerLoad = async ({ url }) => {
	const db = createAdminClient();

	const q = url.searchParams.get('q') ?? '';
	const variantFilter = url.searchParams.get('variant') ?? '';
	const statusFilter = url.searchParams.get('status') ?? '';
	const hasTracksFilter = url.searchParams.get('has_tracks') ?? 'all';
	const sort = url.searchParams.get('sort') ?? 'created_desc';

	let challengesQuery = db.from('challenges').select('*');
	if (variantFilter && (VARIANTS as readonly string[]).includes(variantFilter)) {
		challengesQuery = challengesQuery.eq('variant', variantFilter as never);
	}
	if (statusFilter) {
		challengesQuery = challengesQuery.eq('status', statusFilter);
	}

	const [challengesResult, submissionsResult] = await Promise.all([
		challengesQuery,
		db.from('submissions').select('challenge_id')
	]);

	let challenges = challengesResult.data ?? [];
	const subs = submissionsResult.data ?? [];

	const subCount: Record<string, number> = {};
	for (const s of subs) {
		subCount[s.challenge_id] = (subCount[s.challenge_id] ?? 0) + 1;
	}

	const { data: ctRows } = await db.from('challenge_tracks').select('challenge_id');
	const trackCount: Record<string, number> = {};
	for (const r of ctRows ?? []) {
		trackCount[r.challenge_id] = (trackCount[r.challenge_id] ?? 0) + 1;
	}

	if (q) {
		const lower = q.toLowerCase();
		challenges = challenges.filter((c) => c.title.toLowerCase().includes(lower));
	}
	if (hasTracksFilter === 'yes') {
		challenges = challenges.filter((c) => (trackCount[c.id] ?? 0) > 0);
	} else if (hasTracksFilter === 'no') {
		challenges = challenges.filter((c) => (trackCount[c.id] ?? 0) === 0);
	}

	challenges = [...challenges].sort((a, b) => {
		switch (sort) {
			case 'name_asc':
				return a.title.localeCompare(b.title);
			case 'name_desc':
				return b.title.localeCompare(a.title);
			case 'created_asc':
				return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
			case 'variant_asc':
				return a.variant.localeCompare(b.variant);
			default:
				return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
		}
	});

	return {
		challenges: challenges.map((c) => ({
			...c,
			submissionCount: subCount[c.id] ?? 0,
			trackCount: trackCount[c.id] ?? 0
		})),
		q,
		variantFilter,
		statusFilter,
		hasTracksFilter,
		sort
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const db = createAdminClient();
		const data = await request.formData();

		const title = (data.get('title') as string)?.trim();
		const variant = data.get('variant') as string;
		const stage_label = (data.get('stage_label') as string)?.trim() || null;
		const timer_seconds = parseInt(data.get('timer_seconds') as string, 10) || 60;
		let points_config: object;

		const pointsRaw = (data.get('points_config') as string)?.trim();
		try {
			points_config = pointsRaw ? JSON.parse(pointsRaw) : (DEFAULT_POINTS[variant] ?? {});
		} catch {
			return fail(400, { error: 'points_config must be valid JSON' });
		}

		if (!title || !variant) {
			return fail(400, { error: 'Title and variant are required' });
		}

		const { data: created, error } = await db
			.from('challenges')
			.insert({
				title,
				variant: variant as never,
				stage_label,
				timer_seconds,
				points_config: points_config as never,
				status: 'draft',
				is_active: false,
				created_by: locals.user?.id ?? null
			})
			.select('id')
			.single();

		if (error) return fail(500, { error: error.message });
		redirect(302, `/admin/challenges/${created.id}`);
	},

	delete: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing challenge id' });

		await db.from('answer_options').delete().eq('challenge_id', id);
		await db.from('challenge_tracks').delete().eq('challenge_id', id);
		const { error } = await db.from('challenges').delete().eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: true };
	}
};
