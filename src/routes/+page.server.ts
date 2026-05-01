import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async () => {
	const db = createAdminClient();
	const { data } = await db.from('challenges').select('id').eq('status', 'active').limit(1);
	return { hasActiveGame: (data?.length ?? 0) > 0 };
};
