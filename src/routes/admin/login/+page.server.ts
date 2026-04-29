import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { HOST_PASSWORD } from '$env/static/private';
import { setAdminCookie } from '$lib/server/admin';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.isAdmin) redirect(302, '/admin/challenges');
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const password = data.get('password') as string | null;

		if (!password || password !== HOST_PASSWORD) {
			return fail(401, { error: 'Wrong password' });
		}

		setAdminCookie(cookies);
		redirect(302, '/admin/challenges');
	}
};
