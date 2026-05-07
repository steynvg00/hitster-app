import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createPublicClient } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ cookies }) => {
	const supabase = createPublicClient(cookies);
	await supabase.auth.signOut();
	redirect(302, '/admin/login');
};
