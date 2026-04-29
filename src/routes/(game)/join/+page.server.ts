import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { setTeamCookie } from '$lib/server/team';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.teamId) {
		const redirectTo = url.searchParams.get('redirect') ?? '/team';
		redirect(302, redirectTo);
	}

	const admin = createAdminClient();
	const { data: teams } = await admin
		.from('teams')
		.select('id, color, label, display_name')
		.order('display_name');

	return {
		teams: teams ?? [],
		redirectTo: url.searchParams.get('redirect') ?? '/team',
		error: url.searchParams.get('error')
	};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const formData = await request.formData();
		const teamId = formData.get('team_id') as string;
		const redirectTo = (formData.get('redirect') as string) || '/team';

		if (!teamId) return { error: 'Select a team first' };

		setTeamCookie(cookies, teamId);
		redirect(302, redirectTo);
	}
};
