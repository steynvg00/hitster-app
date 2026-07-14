import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { resolveBattle, maybeResolveBattle, resolveBattlesForRecap } from '$lib/server/battle';

// DEV-ONLY test hook: lets the battle integration harness
// (tests/bots/verify-battle-integration.ts) invoke the REAL resolveBattle /
// maybeResolveBattle against the running app + DB — tsx can't import the server
// module directly (its $lib runtime imports don't resolve outside Vite). 403 in
// prod (Vite eliminates the body). This is NOT the host-facing "Resolve now"
// action; stuk 2 adds that with proper host auth. Do not add production logic here.
export const POST: RequestHandler = async ({ request }) => {
	if (!import.meta.env.DEV) return new Response(null, { status: 403 });

	const body = (await request.json().catch(() => null)) as {
		setId?: string;
		challengeId?: string;
		mode?: 'resolve' | 'maybe' | 'recap-barrier';
	} | null;
	const setId = body?.setId?.trim();
	const challengeId = body?.challengeId?.trim();

	const db = createAdminClient();

	// 'recap-barrier' runs the set-wide barrier (stuk 3a) — the SAME function
	// startRecap and the auto-submit recap flip call. Set-scoped, so no challengeId.
	if (body?.mode === 'recap-barrier') {
		if (!setId) return json({ error: 'setId required' }, { status: 400 });
		const res = await resolveBattlesForRecap(db, setId);
		return json({ ok: true, mode: 'recap-barrier', ...res });
	}

	if (!setId || !challengeId) {
		return json({ error: 'setId + challengeId required' }, { status: 400 });
	}

	if (body?.mode === 'maybe') {
		await maybeResolveBattle(db, setId, challengeId);
		return json({ ok: true, mode: 'maybe' });
	}
	const res = await resolveBattle(db, setId, challengeId);
	return json({ ok: true, mode: 'resolve', ...res });
};
