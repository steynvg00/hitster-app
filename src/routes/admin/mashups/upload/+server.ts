import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';

const BUCKET = 'audio';
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.isAdmin) error(403, 'Forbidden');

	const formData = await request.formData();
	const file = formData.get('file');
	const mashup_id = (formData.get('mashup_id') as string)?.trim();
	const name = (formData.get('name') as string)?.trim();
	const duration_raw = formData.get('duration') as string;

	if (!(file instanceof File)) error(400, 'No file provided');
	if (!file.type.startsWith('audio/')) error(400, `Invalid MIME type: ${file.type}`);
	if (file.size > MAX_SIZE) error(400, `File exceeds 50 MB limit`);
	if (!mashup_id) error(400, 'Missing mashup_id');
	if (!name) error(400, 'Name is required');

	const duration_num = duration_raw ? parseFloat(duration_raw) : null;
	const audio_duration_seconds =
		duration_num != null && !isNaN(duration_num) && duration_num > 0 ? duration_num : null;

	const db = createAdminClient();
	const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
	const objectPath = `mashups/${mashup_id}/${safeName}`;

	const arrayBuffer = await file.arrayBuffer();
	const { error: uploadError } = await db.storage
		.from(BUCKET)
		.upload(objectPath, arrayBuffer, { contentType: file.type, upsert: false });

	if (uploadError) error(500, `Storage upload failed: ${uploadError.message}`);

	const {
		data: { publicUrl }
	} = db.storage.from(BUCKET).getPublicUrl(objectPath);

	const source_track_ids_raw = formData.get('source_track_ids') as string;
	let source_track_ids: string[] = [];
	try {
		const parsed = JSON.parse(source_track_ids_raw || '[]');
		if (Array.isArray(parsed))
			source_track_ids = parsed.filter((x): x is string => typeof x === 'string');
	} catch {
		/* ignore malformed JSON */
	}

	const { error: insertError } = await db.from('mashups').insert({
		id: mashup_id,
		name,
		audio_storage_path: objectPath,
		audio_duration_seconds,
		created_by: locals.user?.id ?? null
	});

	if (insertError) {
		// Roll back the storage upload so we don't leave orphans
		await db.storage.from(BUCKET).remove([objectPath]);
		error(500, `DB insert failed: ${insertError.message}`);
	}

	if (source_track_ids.length > 0) {
		const { error: sourcesError } = await db
			.from('mashup_sources')
			.insert(source_track_ids.map((track_id, i) => ({ mashup_id, track_id, sort_order: i })));
		if (sourcesError) {
			// Roll back mashup row + storage
			await db.from('mashups').delete().eq('id', mashup_id);
			await db.storage.from(BUCKET).remove([objectPath]);
			error(500, `Source tracks insert failed: ${sourcesError.message}`);
		}
	}

	return json({ success: true, path: objectPath, url: publicUrl });
};
