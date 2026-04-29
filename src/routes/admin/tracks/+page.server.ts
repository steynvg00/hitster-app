import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async () => {
	const db = createAdminClient();

	const [tracksResult, clipsResult] = await Promise.all([
		db.from('tracks').select('*').order('artist'),
		db.from('clips').select('*').order('created_at')
	]);

	return {
		tracks: tracksResult.data ?? [],
		clips: clipsResult.data ?? []
	};
};

export const actions: Actions = {
	createTrack: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();

		const artist = (data.get('artist') as string)?.trim();
		const title = (data.get('title') as string)?.trim();
		const year = parseInt(data.get('year') as string, 10);
		const record_label = (data.get('record_label') as string)?.trim() || null;
		const festival = (data.get('festival') as string)?.trim() || null;
		const vocal_source = (data.get('vocal_source') as string)?.trim() || null;
		const genre = (data.get('genre') as string)?.trim() || null;
		const subgenre = (data.get('subgenre') as string)?.trim() || null;

		if (!artist || !title || isNaN(year)) {
			return fail(400, { error: 'Artist, title, and year are required' });
		}

		const { error } = await db.from('tracks').insert({
			artist, title, year, record_label, festival, vocal_source, genre, subgenre
		});
		if (error) return fail(500, { error: error.message });
		return { success: true };
	},

	updateTrack: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();

		const id = data.get('id') as string;
		const artist = (data.get('artist') as string)?.trim();
		const title = (data.get('title') as string)?.trim();
		const year = parseInt(data.get('year') as string, 10);
		const record_label = (data.get('record_label') as string)?.trim() || null;
		const festival = (data.get('festival') as string)?.trim() || null;
		const vocal_source = (data.get('vocal_source') as string)?.trim() || null;
		const genre = (data.get('genre') as string)?.trim() || null;
		const subgenre = (data.get('subgenre') as string)?.trim() || null;

		if (!id || !artist || !title || isNaN(year)) {
			return fail(400, { error: 'Artist, title, and year are required' });
		}

		const { error } = await db.from('tracks').update({
			artist, title, year, record_label, festival, vocal_source, genre, subgenre
		}).eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: true };
	},

	deleteTrack: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing track id' });

		// Delete clips first (FK), then track
		await db.from('clips').delete().eq('track_id', id);
		const { error } = await db.from('tracks').delete().eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: true };
	},

	addClip: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();

		const track_id = data.get('track_id') as string;
		const type = data.get('type') as string;
		const storage_path = (data.get('storage_path') as string)?.trim();
		const positionRaw = data.get('position') as string;
		const position = positionRaw ? parseInt(positionRaw, 10) : null;

		if (!track_id || !type || !storage_path) {
			return fail(400, { error: 'track_id, type, and URL are required' });
		}

		const { error } = await db.from('clips').insert({
			track_id,
			type: type as never,
			storage_path,
			position: isNaN(position as number) ? null : position
		});
		if (error) return fail(500, { error: error.message });
		return { success: true };
	},

	deleteClip: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing clip id' });

		const { error } = await db.from('clips').delete().eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: true };
	}
};
