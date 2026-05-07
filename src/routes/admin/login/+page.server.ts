import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createPublicClient, createAdminClient } from '$lib/server/supabase';

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
	},

	// Dev-only: create a test user and sign in directly, bypassing OAuth.
	// Requires Supabase Auth → Providers → Email → "Allow password login" to be enabled.
	testLogin: async ({ cookies }) => {
		if (process.env.NODE_ENV !== 'development') {
			return fail(403, { error: 'Test login is only available in development' });
		}

		const TEST_EMAIL = 'test@dev.local';
		const TEST_PASSWORD = 'TestLogin123!';

		const db = createAdminClient();

		// Create the test user if it doesn't already exist (idempotent).
		await db.auth.admin.createUser({
			email: TEST_EMAIL,
			password: TEST_PASSWORD,
			email_confirm: true
		});

		// Sign in with password — sets session cookies via @supabase/ssr.
		const supabase = createPublicClient(cookies);
		const { error } = await supabase.auth.signInWithPassword({
			email: TEST_EMAIL,
			password: TEST_PASSWORD
		});
		if (error) return fail(500, { error: `Test login failed: ${error.message}` });

		redirect(302, '/admin');
	}
};
