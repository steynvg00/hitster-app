import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { isNfcUnlockRequired } from '$lib/server/nfc';

export const GET: RequestHandler = async ({ params, locals }) => {
	const { set_id, challenge_id } = params;

	if (!locals.teamId) {
		redirect(302, `/join?redirect=/nfc/unlock/${set_id}/${challenge_id}`);
	}

	const admin = createAdminClient();

	const [{ data: gs }, { data: challenge }] = await Promise.all([
		admin.from('game_sets').select('id, nfc_lock_enabled').eq('id', set_id).maybeSingle(),
		admin.from('challenges').select('nfc_lock_override').eq('id', challenge_id).maybeSingle()
	]);

	if (isNfcUnlockRequired(challenge, gs)) {
		await admin
			.from('challenge_unlocks')
			.upsert(
				{ challenge_id, team_id: locals.teamId, set_id },
				{ onConflict: 'challenge_id,team_id,set_id', ignoreDuplicates: true }
			);
	}

	redirect(302, `/challenge/${challenge_id}`);
};
