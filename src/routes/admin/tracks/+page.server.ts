import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';

async function ensureInPool(
	db: ReturnType<typeof createAdminClient>,
	table: string,
	name: string | null
) {
	if (!name) return;
	await db
		.from(table as never)
		.upsert({ name } as never, { onConflict: 'name', ignoreDuplicates: true });
}

export const load: PageServerLoad = async ({ url }) => {
	const db = createAdminClient();

	const q = url.searchParams.get('q') ?? '';
	const genreFilter = url.searchParams.get('genre') ?? '';
	const hasClips = url.searchParams.get('has_clips') ?? 'all';
	const sort = url.searchParams.get('sort') ?? 'name_asc';

	const [tracksResult, clipsResult, mashupsResult, mashupSourcesResult] = await Promise.all([
		db.from('tracks').select('*'),
		db.from('clips').select('*').order('track_id, created_at'),
		db.from('mashups').select('*').order('name'),
		db.from('mashup_sources').select('*').order('sort_order')
	]);

	let tracks = tracksResult.data ?? [];
	const clips = clipsResult.data ?? [];
	const mashups = (mashupsResult.data ?? []).map((m) => ({
		...m,
		audio_url: m.audio_storage_path
			? db.storage.from('audio').getPublicUrl(m.audio_storage_path).data.publicUrl
			: ''
	}));
	const mashupSources = mashupSourcesResult.data ?? [];

	const tracksWithClips = new Set(clips.map((c) => c.track_id));
	const allGenres = [
		...new Set(
			tracks.map((t) => t.genre).filter((g): g is string => typeof g === 'string' && g.length > 0)
		)
	].sort();

	if (q) {
		const lower = q.toLowerCase();
		tracks = tracks.filter(
			(t) =>
				t.artist.toLowerCase().includes(lower) ||
				t.title.toLowerCase().includes(lower) ||
				(t.genre ?? '').toLowerCase().includes(lower)
		);
	}
	if (genreFilter) {
		tracks = tracks.filter((t) => t.genre === genreFilter);
	}
	if (hasClips === 'yes') {
		tracks = tracks.filter((t) => tracksWithClips.has(t.id));
	} else if (hasClips === 'no') {
		tracks = tracks.filter((t) => !tracksWithClips.has(t.id));
	}

	tracks = [...tracks].sort((a, b) => {
		switch (sort) {
			case 'name_desc':
				return b.artist.localeCompare(a.artist);
			case 'created_desc':
				return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
			case 'created_asc':
				return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
			case 'genre_asc':
				return (a.genre ?? '').localeCompare(b.genre ?? '');
			default:
				return a.artist.localeCompare(b.artist);
		}
	});

	return {
		tracks,
		clips,
		mashups,
		mashupSources,
		allGenres,
		q,
		genreFilter,
		hasClips,
		sort,
		tracksError: tracksResult.error?.message ?? null,
		clipsError: clipsResult.error?.message ?? null
	};
};

export const actions: Actions = {
	createTrack: async ({ request, locals }) => {
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

		const { data: inserted, error } = await db
			.from('tracks')
			.insert({
				artist,
				title,
				year,
				record_label,
				festival,
				vocal_source,
				genre,
				subgenre,
				created_by: locals.user?.id ?? null
			})
			.select('id')
			.single();
		if (error) return fail(500, { error: error.message });
		await Promise.all([
			ensureInPool(db, 'answer_pool_artists', artist),
			ensureInPool(db, 'answer_pool_labels', record_label),
			ensureInPool(db, 'answer_pool_festivals', festival)
		]);
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

		const { error } = await db
			.from('tracks')
			.update({
				artist,
				title,
				year,
				record_label,
				festival,
				vocal_source,
				genre,
				subgenre
			})
			.eq('id', id);
		if (error) return fail(500, { error: error.message });
		await Promise.all([
			ensureInPool(db, 'answer_pool_artists', artist),
			ensureInPool(db, 'answer_pool_labels', record_label),
			ensureInPool(db, 'answer_pool_festivals', festival)
		]);
		return { success: true };
	},

	saveAcceptedTitles: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = data.get('id') as string;
		const raw = (data.get('accepted_titles') as string) ?? '';

		if (!id) return fail(400, { error: 'Missing track id' });

		const accepted_titles = raw
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
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

		const { data: clips } = await db.from('clips').select('storage_object_path').eq('track_id', id);
		const paths = (clips ?? [])
			.map((c) => c.storage_object_path)
			.filter((p): p is string => typeof p === 'string' && p.length > 0);
		if (paths.length > 0) await db.storage.from('audio').remove(paths);

		await db.from('clips').delete().eq('track_id', id);
		const { error } = await db.from('tracks').delete().eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: true };
	},

	addClip: async ({ request, locals }) => {
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
			position: isNaN(position as number) ? null : position,
			created_by: locals.user?.id ?? null
		});
		if (error) return fail(500, { error: error.message });
		return { success: true };
	},

	// createMashup is handled by POST /admin/mashups/upload (client-side upload flow)

	updateMashup: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = (data.get('id') as string)?.trim();
		const name = (data.get('name') as string)?.trim();
		const source_track_ids_raw = data.get('source_track_ids') as string;

		if (!id) return fail(400, { error: 'Missing id' });
		if (!name) return fail(400, { error: 'Name is required' });

		let source_track_ids: string[] = [];
		try {
			const parsed = JSON.parse(source_track_ids_raw || '[]');
			if (Array.isArray(parsed))
				source_track_ids = parsed.filter((x): x is string => typeof x === 'string');
		} catch {
			/* ignore */
		}

		const { error: nameError } = await db.from('mashups').update({ name }).eq('id', id);
		if (nameError) return fail(500, { error: nameError.message });

		// Replace source tracks
		await db.from('mashup_sources').delete().eq('mashup_id', id);
		if (source_track_ids.length > 0) {
			const { error: sourcesError } = await db
				.from('mashup_sources')
				.insert(source_track_ids.map((track_id, i) => ({ mashup_id: id, track_id, sort_order: i })));
			if (sourcesError) return fail(500, { error: sourcesError.message });
		}

		return { success: true, action: 'updateMashup' };
	},

	addMashupSource: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const mashup_id = (data.get('mashup_id') as string)?.trim();
		const track_id = (data.get('track_id') as string)?.trim();
		if (!mashup_id || !track_id) return fail(400, { error: 'Missing mashup_id or track_id' });
		const { data: existing } = await db
			.from('mashup_sources')
			.select('sort_order')
			.eq('mashup_id', mashup_id)
			.order('sort_order', { ascending: false })
			.limit(1);
		const sort_order = (existing?.[0]?.sort_order ?? -1) + 1;
		const { error } = await db
			.from('mashup_sources')
			.insert({ mashup_id, track_id, sort_order })
			.single();
		if (error) return fail(500, { error: error.message });
		return { success: true, action: 'addMashupSource' };
	},

	removeMashupSource: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = (data.get('id') as string)?.trim();
		if (!id) return fail(400, { error: 'Missing id' });
		const { error } = await db.from('mashup_sources').delete().eq('id', id);
		if (error) return fail(500, { error: error.message });
		return { success: true, action: 'removeMashupSource' };
	},

	deleteMashup: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = (data.get('id') as string)?.trim();
		if (!id) return fail(400, { error: 'Missing id' });
		// Fetch audio path before deleting row so we can clean up storage
		const { data: mashup } = await db
			.from('mashups')
			.select('audio_storage_path')
			.eq('id', id)
			.single();
		const { error } = await db.from('mashups').delete().eq('id', id);
		if (error) return fail(500, { error: error.message });
		if (mashup?.audio_storage_path) {
			await db.storage.from('audio').remove([mashup.audio_storage_path]);
		}
		return { success: true, action: 'deleteMashup' };
	},

	deleteClip: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing clip id' });

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
