import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { getTeamIdFromCookie } from '$lib/server/team';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const { challenge_id } = params;

	const teamId = getTeamIdFromCookie(cookies);
	if (!teamId) {
		redirect(302, `/join?redirect=/challenge/${challenge_id}?hint=1`);
	}

	const admin = createAdminClient();

	// Upsert hint-used record (idempotent — second scan is fine)
	await admin.from('challenge_hints_used').upsert(
		{ challenge_id, team_id: teamId },
		{ onConflict: 'challenge_id,team_id', ignoreDuplicates: true }
	);

	redirect(302, `/challenge/${challenge_id}?hint=1`);
};
