import type { RequestHandler } from './$types';

// Handles NFC tap: resolves tag purpose (team identity, team entry, challenge)
// and redirects accordingly. Supabase lookup added next session.
export const GET: RequestHandler = async ({ params }) => {
	const { tag } = params;
	// TODO: look up tag in DB, set team cookie or redirect to challenge
	return new Response(`NFC tag: ${tag}`, { status: 200 });
};
