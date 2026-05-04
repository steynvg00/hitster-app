import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async () => {
	const db = createAdminClient();

	const [tracksResult, clipsResult] = await Promise.all([
		db.from('tracks').select('*').order('artist'),
		db.from('clips').select('*').order('track_id, created_at')
	]);

	return {
		tracks: tracksResult.data ?? [],
		clips: clipsResult.data ?? [],
		tracksError: tracksResult.error?.message ?? null,
		clipsError: clipsResult.error?.message ?? null
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

		const { data: inserted, error } = await db.from('tracks').insert({
			artist, title, year, record_label, festival, vocal_source, genre, subgenre
		}).select('id').single();
		if (error) return fail(500, { error: error.message });
		return { success: true, id: inserted.id };
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

	saveAcceptedTitles: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = data.get('id') as string;
		const raw = (data.get('accepted_titles') as string) ?? '';

		if (!id) return fail(400, { error: 'Missing track id' });

		const accepted_titles = raw.split('\n').map((s) => s.trim()).filter(Boolean);
		if (accepted_titles.length === 0) return fail(400, { error: 'At least one title is required' });

		const { error } = await db.from('tracks').update({ accepted_titles }).eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: true };
	},

	deleteTrack: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing track id' });

		// Remove any storage-hosted clips for this track
		const { data: clips } = await db
			.from('clips')
			.select('storage_object_path')
			.eq('track_id', id);
		const paths = (clips ?? [])
			.map((c) => c.storage_object_path)
			.filter((p): p is string => typeof p === 'string' && p.length > 0);
		if (paths.length > 0) await db.storage.from('audio').remove(paths);

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

	updateClipEffects: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = data.get('id') as string;
		const pitch = parseFloat(data.get('pitch') as string);
		const tempo = parseFloat(data.get('tempo') as string);

		if (!id) return fail(400, { error: 'Missing clip id' });
		if (isNaN(pitch) || pitch < -12 || pitch > 12) return fail(400, { error: 'Pitch out of range' });
		if (isNaN(tempo) || tempo < 0.5 || tempo > 2) return fail(400, { error: 'Tempo out of range' });

		const effects: { pitch?: number; tempo?: number } = {};
		if (pitch !== 0) effects.pitch = pitch;
		if (tempo !== 1) effects.tempo = tempo;

		const { error } = await db.from('clips').update({ effects }).eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: true };
	},

	deleteClip: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing clip id' });

		// Remove from storage if it was uploaded via the new upload path
		const { data: clip } = await db
			.from('clips')
			.select('storage_object_path')
			.eq('id', id)
			.maybeSingle();
		if (clip?.storage_object_path) {
			await db.storage.from('audio').remove([clip.storage_object_path]);
		}

		const { error } = await db.from('clips').delete().eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: true };
	}
};
