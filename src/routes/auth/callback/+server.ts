import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createPublicClient } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	if (code) {
		const supabase = createPublicClient(cookies);
		await supabase.auth.exchangeCodeForSession(code);
	}
	redirect(303, '/admin');
};
