import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { VARIANT_FIELDS, DEFAULT_FIELD_MAX } from '$lib/server/scoring.js';

export const load: PageServerLoad = async () => {
	const db = createAdminClient();
	const { data: rows } = await db.from('variant_defaults').select('*');

	const byVariant = new Map((rows ?? []).map((r) => [r.variant, r.points_config]));

	const variants = Object.keys(VARIANT_FIELDS).map((variant) => {
		const saved = (byVariant.get(variant) as Record<string, unknown> | null) ?? {};
		const fieldPoints = (saved.field_points ?? {}) as Record<string, number>;
		const fields = VARIANT_FIELDS[variant].map((f) => ({
			field: f,
			points: fieldPoints[f] ?? DEFAULT_FIELD_MAX[f] ?? 5
		}));
		return { variant, fields };
	});

	return { variants };
};
