import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { VARIANT_FIELDS, DEFAULT_FIELD_MAX } from '$lib/server/scoring.js';

export const load: PageServerLoad = async ({ params }) => {
	const variant = params.variant;
	if (!VARIANT_FIELDS[variant]) redirect(302, '/admin/variant-defaults');

	const db = createAdminClient();
	const { data: row } = await db.from('variant_defaults').select('points_config, streak_config, tutorial_text').eq('variant', variant).maybeSingle();

	const saved = (row?.points_config as Record<string, unknown> | null) ?? {};
	const savedPoints = (saved.field_points ?? {}) as Record<string, number>;

	const fields = VARIANT_FIELDS[variant].map((f) => ({
		field: f,
		points: savedPoints[f] ?? DEFAULT_FIELD_MAX[f] ?? 5
	}));

	const streakConfigJson = row?.streak_config
		? JSON.stringify(row.streak_config, null, 2)
		: JSON.stringify({ thresholds: [{ streak: 3, bonus: 5 }, { streak: 5, bonus: 10 }] }, null, 2);

	const tutorialText = row?.tutorial_text ?? '';

	return { variant, fields, streakConfigJson, tutorialText };
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

		const streakRaw = (data.get('streak_config') as string | null)?.trim();
		let streak_config: object | null = null;
		if (streakRaw) {
			try {
				streak_config = JSON.parse(streakRaw);
			} catch {
				return fail(400, { error: 'streak_config must be valid JSON' });
			}
		}

		const tutorialText = (data.get('tutorial_text') as string | null)?.trim() || null;

		const { error: upsertErr } = await db.from('variant_defaults').upsert({
			variant,
			points_config: { field_points },
			streak_config: streak_config as never,
			tutorial_text: tutorialText
		});

		if (upsertErr) return fail(500, { error: upsertErr.message });

		return { saved: true };
	}
};
