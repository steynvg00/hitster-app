import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createPublicClient } from '$lib/server/supabase';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(302, '/admin');
};

export const actions: Actions = {
	google: async ({ url, cookies }) => {
		const supabase = createPublicClient(cookies);
		const { data, error } = await supabase.auth.signInWithOAuth({
			provider: 'google',
			options: {
				redirectTo: `${url.origin}/auth/callback`,
				skipBrowserRedirect: true
			}
		});
		if (error) return fail(500, { error: error.message });
		if (data.url) redirect(302, data.url);
	},

	email: async ({ request, url, cookies }) => {
		const supabase = createPublicClient(cookies);
		const formData = await request.formData();
		const email = (formData.get('email') as string | null)?.trim();
		if (!email) return fail(400, { error: 'Email is required' });

		const { error } = await supabase.auth.signInWithOtp({
			email,
			options: { emailRedirectTo: `${url.origin}/auth/callback` }
		});
		if (error) return fail(500, { error: error.message });
		return { sent: true, email };
	}

	// The old dev-only ?/testLogin action was removed — local admin now needs no
	// login at all (see the import.meta.env.DEV bypass in src/hooks.server.ts).
};
