import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase';

const BUCKET = 'audio';
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const CLIP_TYPES = ['snippet', 'fragment', 'kick', 'vocal', 'mashup'] as const;
type ClipType = (typeof CLIP_TYPES)[number];

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.isAdmin) error(403, 'Forbidden');

	const track_id = params.id;
	if (!track_id) error(400, 'Missing track id');

	const formData = await request.formData();
	const file = formData.get('file');
	const clip_type = (formData.get('clip_type') as string)?.trim();
	const order_index_raw = formData.get('order_index') as string;
	const duration_raw = formData.get('duration') as string;

	if (!(file instanceof File)) error(400, 'No file provided');
	if (!file.type.startsWith('audio/')) error(400, `Invalid MIME type: ${file.type}`);
	if (file.size > MAX_SIZE) error(400, `File exceeds 10 MB limit`);
	if (!CLIP_TYPES.includes(clip_type as ClipType)) error(400, `Invalid clip type: ${clip_type}`);

	const order_index_num = order_index_raw ? parseInt(order_index_raw, 10) : null;
	const position = order_index_num != null && !isNaN(order_index_num) ? order_index_num : null;
	const duration_num = duration_raw ? parseFloat(duration_raw) : null;
	const duration = duration_num != null && !isNaN(duration_num) && duration_num > 0 ? duration_num : null;

	const db = createAdminClient();

	// Sanitize filename: keep alphanumeric, dots, dashes, underscores
	const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
	let objectPath = `${track_id}/${clip_type}/${safeName}`;

	// Collision check — append timestamp if the same key already exists
	const { data: existing } = await db.storage
		.from(BUCKET)
		.list(`${track_id}/${clip_type}`, { search: safeName });

	if (existing?.some((f) => f.name === safeName)) {
		const dotIdx = safeName.lastIndexOf('.');
		const base = dotIdx >= 0 ? safeName.slice(0, dotIdx) : safeName;
		const ext = dotIdx >= 0 ? safeName.slice(dotIdx) : '';
		objectPath = `${track_id}/${clip_type}/${base}_${Date.now()}${ext}`;
	}

	const arrayBuffer = await file.arrayBuffer();
	const { error: uploadError } = await db.storage
		.from(BUCKET)
		.upload(objectPath, arrayBuffer, { contentType: file.type, upsert: false });

	if (uploadError) error(500, `Storage upload failed: ${uploadError.message}`);

	const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(objectPath);

	const { error: insertError } = await db.from('clips').insert({
		track_id,
		type: clip_type as ClipType,
		storage_path: publicUrl,
		storage_object_path: objectPath,
		position,
		duration,
		created_by: locals.user?.id ?? null
	});

	if (insertError) {
		// Roll back the storage upload so we don't leave orphans
		await db.storage.from(BUCKET).remove([objectPath]);
		error(500, `DB insert failed: ${insertError.message}`);
	}

	return json({ success: true, path: objectPath, url: publicUrl });
};
