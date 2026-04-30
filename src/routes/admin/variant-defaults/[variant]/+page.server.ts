import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { VARIANT_FIELDS, DEFAULT_FIELD_MAX } from '$lib/server/scoring.js';

export const load: PageServerLoad = async ({ params }) => {
	const variant = params.variant;
	if (!VARIANT_FIELDS[variant]) redirect(302, '/admin/variant-defaults');

	const db = createAdminClient();
	const { data: row } = await db.from('variant_defaults').select('points_config').eq('variant', variant).maybeSingle();

	const saved = (row?.points_config as Record<string, unknown> | null) ?? {};
	const savedPoints = (saved.field_points ?? {}) as Record<string, number>;

	const fields = VARIANT_FIELDS[variant].map((f) => ({
		field: f,
		points: savedPoints[f] ?? DEFAULT_FIELD_MAX[f] ?? 5
	}));

	return { variant, fields };
};

export const actions: Actions = {
	save: async ({ request, params }) => {
		const variant = params.variant;
		if (!VARIANT_FIELDS[variant]) return fail(400, { error: 'Unknown variant' });

		const db = createAdminClient();
		const data = await request.formData();

		const field_points: Record<string, number> = {};
		for (const f of VARIANT_FIELDS[variant]) {
			const v = parseInt(data.get(`points_${f}`) as string, 10);
			field_points[f] = isNaN(v) || v < 0 ? 0 : v;
		}

		const { error: upsertErr } = await db.from('variant_defaults').upsert({
			variant,
			points_config: { field_points }
		});

		if (upsertErr) return fail(500, { error: upsertErr.message });

		return { saved: true };
	}
};
