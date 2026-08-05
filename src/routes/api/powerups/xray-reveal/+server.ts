import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { spendXrayReveal } from '$lib/server/powerups';

// Spend ONE reveal from the calling team's running X-Ray budget.
//
// An endpoint rather than a form action for one structural reason: the reveal
// button sits INSIDE the challenge's answer form, and a nested <form> is invalid
// HTML — a second form there would either be dropped by the parser or submit the
// challenge. A type="button" + fetch keeps the answer form untouched.
//
// team_effects has no anon write policy, so the write goes through the admin
// client; authorization is the same explicit ownership check /api/effects/consume
// uses — everything is scoped to locals.teamId, so a team can only spend its own
// budget. All the budget and reveal logic lives in spendXrayReveal(); this is the
// transport.
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.teamId) error(401, 'No team');

	const body = (await request.json().catch(() => null)) as {
		challenge_id?: string;
		tab_id?: string | null;
		slot_index?: number;
		field?: string;
	} | null;

	const challengeId = body?.challenge_id?.trim();
	const field = body?.field?.trim();
	if (!challengeId || !field) return json({ error: 'Missing challenge_id or field' }, { status: 400 });

	const slotIndex =
		typeof body?.slot_index === 'number' && Number.isInteger(body.slot_index) && body.slot_index >= 0
			? body.slot_index
			: 0;

	const result = await spendXrayReveal(createAdminClient(), {
		teamId: locals.teamId,
		challengeId,
		field,
		tabId: body?.tab_id?.trim() || null,
		slotIndex
	});

	// A refused cell is a 400 with a reason the player can act on ("this tab has no
	// track behind it yet"), and it cost no budget.
	if (!result.success) return json({ error: result.error }, { status: 400 });

	return json({ reveal: result.reveal, remaining: result.remaining });
};
