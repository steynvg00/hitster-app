import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { setPlayerCookie } from '$lib/server/player';

const VALID_MODES = ['solo', 'teams'] as const;
type PlayMode = (typeof VALID_MODES)[number];

const DB_MODE: Record<PlayMode, 'team' | 'solo_group'> = {
	teams: 'team',
	solo: 'solo_group'
};

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
const PHOTO_BUCKET = 'player_photos';

function postOnboardRedirect(mode: PlayMode, next?: string | null): string {
	if (mode === 'teams') {
		// Allow any safe internal path (starts with / and no protocol)
		if (next && next.startsWith('/') && !next.includes('://')) return next;
		return '/play/teams/sets';
	}
	return `/play/${mode}/lobby`;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const mode = params.mode as PlayMode;
	if (!VALID_MODES.includes(mode)) redirect(302, '/');

	// Already has a live player session — skip onboarding (preserve ?next= so NFC return works)
	if (locals.playerId) redirect(302, postOnboardRedirect(mode, url.searchParams.get('next')));

	const next = url.searchParams.get('next');

	// gamesetLogo voedt state (a) van scherm 1D (logo 200px bovenaan, spinlogo
	// eronder). `game_sets` heeft nog GEEN logokolom, dus dit is voorlopig altijd
	// null en onboarding rendert state (b) — het default-scherm met alleen het
	// M!XUP-spinlogo. Zodra de kolom bestaat is dit de enige plek die wijzigt.
	const gamesetLogo: string | null = null;

	return { mode, next, gamesetLogo };
};

export const actions: Actions = {
	default: async ({ request, params, cookies }) => {
		const mode = params.mode as PlayMode;
		if (!VALID_MODES.includes(mode)) return fail(400, { error: 'Invalid mode', name: '' });

		const formData = await request.formData();
		const name = (formData.get('name') as string | null)?.trim() ?? '';
		const photoFile = formData.get('photo');
		const next = formData.get('next') as string | null;

		if (name.length < 2 || name.length > 30) {
			return fail(400, { error: 'Name must be 2–30 characters', name });
		}

		const db = createAdminClient();
		const session_token = crypto.randomUUID();
		const session_expires_at = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

		let photo_url: string | null = null;

		if (photoFile instanceof File && photoFile.size > 0) {
			if (!photoFile.type.startsWith('image/') && photoFile.type !== '') {
				return fail(400, { error: 'Photo must be an image file (JPEG, PNG, WebP…)', name });
			}
			if (photoFile.size > MAX_PHOTO_BYTES) {
				return fail(400, { error: 'Photo must be under 5 MB', name });
			}

			const objectPath = `${session_token}.jpg`;
			const { error: uploadError } = await db.storage
				.from(PHOTO_BUCKET)
				.upload(objectPath, await photoFile.arrayBuffer(), {
					contentType: photoFile.type || 'image/jpeg',
					// Zonder deze optie zet Supabase Storage `cache-control: no-cache`, en
					// dan haalt elke navigatie naar /team elke spelersfoto opnieuw op. Het
					// objectpad bevat het session_token en wordt nooit hergebruikt
					// (upsert: false), dus een week vasthouden kan geen verouderde foto
					// opleveren.
					cacheControl: '604800',
					upsert: false
				});

			if (uploadError) {
				return fail(500, { error: 'Photo upload failed — try again', name });
			}

			({
				data: { publicUrl: photo_url }
			} = db.storage.from(PHOTO_BUCKET).getPublicUrl(objectPath));
		}

		const { data: player, error: insertError } = await db
			.from('players')
			.insert({
				name,
				display_name: name,
				photo_url,
				session_token,
				mode: DB_MODE[mode],
				session_expires_at
			})
			.select('id')
			.single();

		if (insertError || !player) {
			if (photo_url) await db.storage.from(PHOTO_BUCKET).remove([`${session_token}.jpg`]);
			return fail(500, { error: 'Could not create player — try again', name });
		}

		setPlayerCookie(cookies, player.id);
		redirect(303, postOnboardRedirect(mode, next));
	}
};
