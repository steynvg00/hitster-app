import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { CHALLENGE_TYPES } from '$lib/variants';
import { TYPE_FIELDS, DEFAULT_FIELD_MAX } from '$lib/server/scoring';
import type { ChallengeType } from '$lib/types/index.js';

export const load: PageServerLoad = async ({ url }) => {
	const db = createAdminClient();

	const q = url.searchParams.get('q') ?? '';
	const typeFilter = url.searchParams.get('type') ?? '';
	const statusFilter = url.searchParams.get('status') ?? '';
	const hasTabsFilter = url.searchParams.get('has_tabs') ?? 'all';
	const sort = url.searchParams.get('sort') ?? 'created_desc';

	let challengesQuery = db.from('challenges').select('*');
	if (typeFilter && (CHALLENGE_TYPES as readonly string[]).includes(typeFilter)) {
		challengesQuery = challengesQuery.eq('variant', typeFilter as never);
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

	const { data: tabRows } = await db.from('challenge_tabs').select('challenge_id');
	const tabCount: Record<string, number> = {};
	for (const r of tabRows ?? []) {
		tabCount[r.challenge_id] = (tabCount[r.challenge_id] ?? 0) + 1;
	}

	if (q) {
		const lower = q.toLowerCase();
		challenges = challenges.filter((c) => c.title.toLowerCase().includes(lower));
	}
	if (hasTabsFilter === 'yes') {
		challenges = challenges.filter((c) => (tabCount[c.id] ?? 0) > 0);
	} else if (hasTabsFilter === 'no') {
		challenges = challenges.filter((c) => (tabCount[c.id] ?? 0) === 0);
	}

	challenges = [...challenges].sort((a, b) => {
		switch (sort) {
			case 'name_asc':
				return a.title.localeCompare(b.title);
			case 'name_desc':
				return b.title.localeCompare(a.title);
			case 'created_asc':
				return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
			case 'type_asc':
				return a.variant.localeCompare(b.variant);
			default:
				return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
		}
	});

	return {
		challenges: challenges.map((c) => ({
			...c,
			submissionCount: subCount[c.id] ?? 0,
			tabCount: tabCount[c.id] ?? 0
		})),
		q,
		typeFilter,
		statusFilter,
		hasTabsFilter,
		sort
	};
};

export const actions: Actions = {
	createChallenge: async ({ request, locals }) => {
		const db = createAdminClient();
		const data = await request.formData();

		const rawType = (data.get('type') as string)?.trim();
		// Instrument is a preset over the standard variant — same tab/track/scoring
		// machinery as Standard, just pre-seeded with an artist-only fields config.
		const isInstrument = rawType === 'instrument';
		const type = (isInstrument ? 'standard' : rawType) as ChallengeType;
		const title =
			(data.get('title') as string)?.trim() ||
			`New ${isInstrument ? 'instrument' : type} challenge`;

		if (!isInstrument && (!type || !(CHALLENGE_TYPES as readonly string[]).includes(type))) {
			return fail(400, { error: 'Invalid challenge type' });
		}

		let points_config: { field_points?: Record<string, number>; fields?: unknown };
		if (isInstrument) {
			points_config = {
				fields: [{ name: 'artist', input_mode: 'combobox', max_points: 10, is_bonus: false }]
			};
		} else {
			// Default points from DEFAULT_FIELD_MAX for the type's fields
			const fields = TYPE_FIELDS[type] ?? ['artist', 'title', 'year'];
			const fieldPoints: Record<string, number> = {};
			for (const f of fields) {
				fieldPoints[f] = DEFAULT_FIELD_MAX[f as keyof typeof DEFAULT_FIELD_MAX] ?? 10;
			}
			points_config = { field_points: fieldPoints };
		}

		const { data: created, error } = await db
			.from('challenges')
			.insert({
				title,
				variant: type as never,
				timer_seconds: 60,
				points_config: points_config as never,
				status: 'draft',
				is_active: false,
				created_by: locals.user?.id ?? null
			})
			.select('id')
			.single();

		if (error) return fail(500, { error: error.message });
		if (!created) return fail(500, { error: 'Challenge creation returned no data' });
		redirect(302, `/admin/challenges/${created.id}`);
	},

	delete: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing challenge id' });

		await db.from('answer_options').delete().eq('challenge_id', id);
		// challenge_tabs cascade deletes source_tracks + clips
		await db.from('challenge_tabs').delete().eq('challenge_id', id);
		const { error } = await db.from('challenges').delete().eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: true };
	}
};
