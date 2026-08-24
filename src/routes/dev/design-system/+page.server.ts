import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Dev-only showcase van het redesign-fundament. Bestaat niet in productie —
 * zelfde posture als /api/dev/state en DevNav.svelte.
 */
export const load: PageServerLoad = async () => {
	if (!import.meta.env.DEV) error(404, 'Not found');
	return {};
};
