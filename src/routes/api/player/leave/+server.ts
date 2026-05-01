import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { clearPlayerCookie } from '$lib/server/player';

export const POST: RequestHandler = async ({ locals, cookies }) => {
	if (locals.playerId) {
		const db = createAdminClient();

		const { data: player } = await db
			.from('players')
			.select('session_token, photo_url')
			.eq('id', locals.playerId)
			.maybeSingle();

		if (player?.session_token && player.photo_url) {
			await db.storage.from('player_photos').remove([`${player.session_token}.jpg`]);
		}

		await db.from('players').delete().eq('id', locals.playerId);
		clearPlayerCookie(cookies);
	}

	return json({ success: true });
};
