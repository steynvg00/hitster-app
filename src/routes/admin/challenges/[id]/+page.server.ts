import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { CHALLENGE_TYPES } from '$lib/variants';

export const load: PageServerLoad = async ({ params, locals }) => {
	const db = createAdminClient();

	const { data: challenge, error: cErr } = await db
		.from('challenges')
		.select('*')
		.eq('id', params.id)
		.single();
	if (cErr || !challenge) error(404, 'Challenge not found');

	// Load tabs with their source tracks and clips
	const { data: tabs } = await db
		.from('challenge_tabs')
		.select('*')
		.eq('challenge_id', params.id)
		.order('position');

	const tabIds = (tabs ?? []).map((t) => t.id);

	const [
		sourceTracksResult,
		tabClipsResult,
		allTracksResult,
		answerOptionsResult,
		mashupsResult,
		mashupSourcesResult
	] = await Promise.all([
		tabIds.length
			? db.from('challenge_tab_source_tracks').select('*').in('tab_id', tabIds).order('sort_order')
			: Promise.resolve({ data: [] }),
		tabIds.length
			? db.from('challenge_tab_clips').select('*').in('tab_id', tabIds).order('sort_order')
			: Promise.resolve({ data: [] }),
		db.from('tracks').select('*').order('artist'),
		db.from('answer_options').select('*').eq('challenge_id', params.id),
		db.from('mashups').select('*').order('name'),
		db.from('mashup_sources').select('*').order('sort_order')
	]);

	const allTracks = allTracksResult.data ?? [];
	const allTrackIds = allTracks.map((t) => t.id);

	const { data: rawClips } = await db
		.from('clips')
		.select('*')
		.in('track_id', allTrackIds.length ? allTrackIds : ['__none__']);

	// Normalise storage_path to a resolvable URL.
	// Canonical source: storage_object_path + 'audio' bucket (set by the upload endpoint).
	// Legacy clips (manually inserted) have storage_object_path = null; fall back to
	// storage_path if it looks like a full URL, otherwise surface as empty string so the
	// diagnostic log in the editor makes the data issue visible.
	const clips = (rawClips ?? []).map((c) => {
		const objPath = (c as unknown as { storage_object_path?: string | null }).storage_object_path;
		let resolvedUrl: string;
		if (objPath) {
			resolvedUrl = db.storage.from('audio').getPublicUrl(objPath).data.publicUrl;
		} else if (c.storage_path?.startsWith('http')) {
			resolvedUrl = c.storage_path;
		} else {
			resolvedUrl = '';
		}
		return {
			...c,
			storage_path: resolvedUrl,
			storage_object_path: objPath ?? null
		};
	});

	const { data: userPresets } = await db
		.from('effect_presets')
		.select('*')
		.eq('is_builtin', false)
		.eq('created_by', locals.user?.id ?? '')
		.order('created_at');

	return {
		challenge,
		tabs: tabs ?? [],
		sourceTracksByTab: sourceTracksResult.data ?? [],
		clipsByTab: tabClipsResult.data ?? [],
		allTracks,
		clips,
		answerOptions: answerOptionsResult.data ?? [],
		mashups: (mashupsResult.data ?? []).map((m) => ({
			...m,
			audio_url: m.audio_storage_path
				? db.storage.from('audio').getPublicUrl(m.audio_storage_path).data.publicUrl
				: ''
		})),
		mashupSources: mashupSourcesResult.data ?? [],
		userPresets: userPresets ?? []
	};
};

export const actions: Actions = {
	updateMeta: async ({ request, params }) => {
		const db = createAdminClient();
		const data = await request.formData();

		const title = (data.get('title') as string)?.trim();
		const stage_label = (data.get('stage_label') as string)?.trim() || null;
		const timer_seconds = parseInt(data.get('timer_seconds') as string, 10) || 60;
		const variant = data.get('variant') as string;
		const difficultyRaw = parseInt(data.get('difficulty_rating') as string, 10);
		const difficulty_rating = difficultyRaw >= 1 && difficultyRaw <= 5 ? difficultyRaw : 3;
		const speedRaw = (data.get('speed_threshold_seconds') as string | null)?.trim();
		const speed_threshold_seconds = speedRaw ? parseInt(speedRaw, 10) || null : null;
		const hint_text = (data.get('hint_text') as string | null)?.trim() || null;
		const nfcOverrideRaw = data.get('nfc_lock_override') as string | null;
		const nfc_lock_override =
			nfcOverrideRaw === 'true' ? true : nfcOverrideRaw === 'false' ? false : null;

		// Collect field_points from form (field_points[artist]=10 etc.)
		const fieldPointEntries: Record<string, number> = {};
		for (const [key, val] of data.entries()) {
			if (key.startsWith('field_points[') && key.endsWith(']')) {
				const field = key.slice(13, -1);
				const n = parseInt(val as string, 10);
				if (!isNaN(n)) fieldPointEntries[field] = n;
			}
		}

		if (!title) return fail(400, { error: 'Title is required' });
		if (!variant || !(CHALLENGE_TYPES as readonly string[]).includes(variant)) {
			return fail(400, { error: 'Invalid type' });
		}

		// Preserve existing field_modes when saving meta
		const { data: existing } = await db
			.from('challenges')
			.select('points_config')
			.eq('id', params.id)
			.single();
		const existingPc = (existing?.points_config ?? {}) as Record<string, unknown>;
		const existingModes = (existingPc.field_modes ?? {}) as Record<string, string>;

		const points_config = {
			field_modes: existingModes,
			field_points: fieldPointEntries
		};

		const { error: e } = await db
			.from('challenges')
			.update({
				title,
				stage_label,
				timer_seconds,
				variant: variant as never,
				points_config: points_config as never,
				difficulty_rating,
				speed_threshold_seconds,
				hint_text,
				nfc_lock_override
			})
			.eq('id', params.id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'meta' };
	},

	setStatus: async ({ request, params }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const status = data.get('status') as string;
		if (!['draft', 'active', 'completed'].includes(status))
			return fail(400, { error: 'Invalid status' });

		const { error: e } = await db
			.from('challenges')
			.update({ status, is_active: status === 'active' })
			.eq('id', params.id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'status' };
	},

	// ── Tab management ──────────────────────────────────────────────────────────

	addTab: async ({ params, locals }) => {
		const db = createAdminClient();

		const { data: existing } = await db
			.from('challenge_tabs')
			.select('position')
			.eq('challenge_id', params.id)
			.order('position', { ascending: false })
			.limit(1);

		const position = (existing?.[0]?.position ?? -1) + 1;

		const { data: newTab, error: e } = await db
			.from('challenge_tabs')
			.insert({ challenge_id: params.id, position, created_by: locals.user?.id ?? null })
			.select('id')
			.single();
		if (e || !newTab) return fail(500, { error: e?.message ?? 'Could not create tab' });
		return { success: true, action: 'addTab', tabId: newTab.id };
	},

	removeTab: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const tab_id = data.get('tab_id') as string;
		if (!tab_id) return fail(400, { error: 'Missing tab_id' });
		// CASCADE deletes source_tracks and clips for this tab
		const { error: e } = await db.from('challenge_tabs').delete().eq('id', tab_id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'removeTab' };
	},

	setTabSourceTrack: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const tab_id = data.get('tab_id') as string;
		const track_id = data.get('track_id') as string;
		const existing_src_id = data.get('existing_src_id') as string | null;

		if (!tab_id || !track_id) return fail(400, { error: 'Missing tab_id or track_id' });

		if (existing_src_id) {
			await db.from('challenge_tab_source_tracks').update({ track_id }).eq('id', existing_src_id);
		} else {
			await db.from('challenge_tab_source_tracks').insert({ tab_id, track_id, sort_order: 0 });
		}
		return { success: true, action: 'setTabSourceTrack' };
	},

	addTabSourceTrack: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const tab_id = data.get('tab_id') as string;
		const track_id = data.get('track_id') as string;
		if (!tab_id || !track_id) return fail(400, { error: 'Missing tab_id or track_id' });

		const { data: existing } = await db
			.from('challenge_tab_source_tracks')
			.select('sort_order')
			.eq('tab_id', tab_id)
			.order('sort_order', { ascending: false })
			.limit(1);
		const sort_order = (existing?.[0]?.sort_order ?? -1) + 1;

		const { error: e } = await db
			.from('challenge_tab_source_tracks')
			.insert({ tab_id, track_id, sort_order });
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'addTabSourceTrack' };
	},

	removeTabSourceTrack: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const src_id = data.get('src_id') as string;
		if (!src_id) return fail(400, { error: 'Missing src_id' });
		const { error: e } = await db.from('challenge_tab_source_tracks').delete().eq('id', src_id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'removeTabSourceTrack' };
	},

	setTabClip: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const tab_id = data.get('tab_id') as string;
		const clip_id = data.get('clip_id') as string;
		const existing_clip_id = data.get('existing_clip_id') as string | null;

		if (!tab_id || !clip_id) return fail(400, { error: 'Missing tab_id or clip_id' });

		if (existing_clip_id) {
			await db.from('challenge_tab_clips').update({ clip_id }).eq('id', existing_clip_id);
		} else {
			await db
				.from('challenge_tab_clips')
				.insert({ tab_id, clip_id, fragment_number: null, sort_order: 0 });
		}
		return { success: true, action: 'setTabClip' };
	},

	addTabClip: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const tab_id = data.get('tab_id') as string;
		const clip_id = data.get('clip_id') as string;
		const fragment_number = data.get('fragment_number') as string | null;

		if (!tab_id || !clip_id) return fail(400, { error: 'Missing tab_id or clip_id' });

		const { data: existing } = await db
			.from('challenge_tab_clips')
			.select('sort_order')
			.eq('tab_id', tab_id)
			.order('sort_order', { ascending: false })
			.limit(1);
		const sort_order = (existing?.[0]?.sort_order ?? -1) + 1;

		const fn = fragment_number ? parseInt(fragment_number, 10) : null;

		const { error: e } = await db
			.from('challenge_tab_clips')
			.insert({ tab_id, clip_id, fragment_number: fn, sort_order });
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'addTabClip' };
	},

	removeTabClip: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const tc_id = data.get('tc_id') as string;
		if (!tc_id) return fail(400, { error: 'Missing tc_id' });
		const { error: e } = await db.from('challenge_tab_clips').delete().eq('id', tc_id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'removeTabClip' };
	},

	setTabMashup: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const tab_id = data.get('tab_id') as string;
		const mashup_id = (data.get('mashup_id') as string) || null;
		if (!tab_id) return fail(400, { error: 'Missing tab_id' });
		const { error: e } = await db.from('challenge_tabs').update({ mashup_id }).eq('id', tab_id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'setTabMashup' };
	},

	// ── Answer options / input modes ────────────────────────────────────────────

	generateOptions: async ({ request, params, locals }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const src_id = data.get('src_id') as string;
		const field = data.get('field') as string;

		if (!src_id || !field) return fail(400, { error: 'Missing src_id or field' });

		const { data: src } = await db
			.from('challenge_tab_source_tracks')
			.select('track_id')
			.eq('id', src_id)
			.single();
		if (!src) return fail(400, { error: 'Source track not found' });

		const { data: track } = await db.from('tracks').select('*').eq('id', src.track_id).single();
		if (!track) return fail(400, { error: 'Track not found' });

		type TrackKey = keyof typeof track;
		const correct = track[field as TrackKey];
		if (correct == null || correct === '')
			return fail(400, { error: `Track has no value for field "${field}"` });

		const { data: others } = await db
			.from('tracks')
			.select(field)
			.neq('id', src.track_id)
			.not(field, 'is', null)
			.limit(100);

		const distSet = new Set<string>();
		for (const r of others ?? []) {
			const v = String((r as unknown as Record<string, unknown>)[field] ?? '').trim();
			if (v && v !== String(correct)) distSet.add(v);
		}
		const distractors = [...distSet].sort(() => Math.random() - 0.5).slice(0, 7);
		const options = [String(correct), ...distractors].sort(() => Math.random() - 0.5);

		await db
			.from('answer_options')
			.delete()
			.eq('challenge_id', params.id)
			.eq('field', field as never);

		if (options.length > 0) {
			const { error: e } = await db.from('answer_options').insert(
				options.map((value) => ({
					challenge_id: params.id,
					field: field as never,
					value,
					created_by: locals.user?.id ?? null
				}))
			);
			if (e) return fail(500, { error: e.message });
		}
		return { success: true, action: 'generateOptions' };
	},

	saveOptions: async ({ request, params, locals }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const field = data.get('field') as string;
		const raw = data.get('options') as string;

		if (!field || raw == null) return fail(400, { error: 'Missing field or options' });

		const options = raw
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);

		await db
			.from('answer_options')
			.delete()
			.eq('challenge_id', params.id)
			.eq('field', field as never);

		if (options.length > 0) {
			const { error: e } = await db.from('answer_options').insert(
				options.map((value) => ({
					challenge_id: params.id,
					field: field as never,
					value,
					created_by: locals.user?.id ?? null
				}))
			);
			if (e) return fail(500, { error: e.message });
		}
		return { success: true, action: 'saveOptions' };
	},

	saveInputMode: async ({ request, params }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const field = data.get('field') as string;
		const mode = data.get('mode') as string;

		const VALID_MODES = ['multiple_choice', 'combobox', 'open_text', 'typeable_number', 'slider'];
		if (!field || !VALID_MODES.includes(mode)) return fail(400, { error: 'Invalid field or mode' });

		const { data: challenge } = await db
			.from('challenges')
			.select('points_config')
			.eq('id', params.id)
			.single();
		if (!challenge) return fail(404, { error: 'Challenge not found' });

		const pc = (challenge.points_config ?? {}) as Record<string, unknown>;
		const fieldModes = (pc.field_modes ?? {}) as Record<string, string>;
		fieldModes[field] = mode;

		const { error: e } = await db
			.from('challenges')
			.update({ points_config: { ...pc, field_modes: fieldModes } as never })
			.eq('id', params.id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'saveInputMode' };
	},

	saveFieldPoints: async ({ request, params }) => {
		const db = createAdminClient();
		const data = await request.formData();

		const submitted: Record<string, number> = {};
		for (const [key, val] of data.entries()) {
			if (key.startsWith('field_points[') && key.endsWith(']')) {
				const field = key.slice(13, -1);
				const n = parseInt(val as string, 10);
				if (!isNaN(n) && n > 0) submitted[field] = n;
			}
		}

		const { data: challenge } = await db
			.from('challenges')
			.select('points_config')
			.eq('id', params.id)
			.single();
		if (!challenge) return fail(404, { error: 'Challenge not found' });

		const pc = (challenge.points_config ?? {}) as Record<string, unknown>;
		const existing = (pc.field_points ?? {}) as Record<string, number>;
		const { error: e } = await db
			.from('challenges')
			.update({ points_config: { ...pc, field_points: { ...existing, ...submitted } } as never })
			.eq('id', params.id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'saveFieldPoints' };
	},

	saveTabEffects: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const tab_id = data.get('tab_id') as string;
		const effects_json = data.get('effects_json') as string;
		if (!tab_id) return fail(400, { error: 'Missing tab_id' });
		let effects: unknown;
		try {
			effects = JSON.parse(effects_json);
		} catch {
			return fail(400, { error: 'Invalid effects JSON' });
		}
		const { error: e } = await db
			.from('challenge_tabs')
			.update({ effects: effects as never })
			.eq('id', tab_id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'saveTabEffects' };
	},

	duplicateChallenge: async ({ params, locals }) => {
		const db = createAdminClient();

		const { data: source } = await db.from('challenges').select('*').eq('id', params.id).single();
		if (!source) return fail(404, { error: 'Challenge not found' });

		const { data: newChallenge, error: insertErr } = await db
			.from('challenges')
			.insert({
				title: `${source.title} (copy)`,
				variant: source.variant,
				stage_label: source.stage_label,
				timer_seconds: source.timer_seconds,
				points_config: source.points_config as never,
				difficulty_rating: source.difficulty_rating,
				speed_threshold_seconds: source.speed_threshold_seconds,
				hint_text: source.hint_text,
				nfc_lock_override: source.nfc_lock_override,
				status: 'draft',
				is_active: false,
				created_by: locals.user?.id ?? null
			})
			.select('id')
			.single();

		if (insertErr || !newChallenge)
			return fail(500, { error: insertErr?.message ?? 'Could not duplicate' });

		// Copy tabs + their source_tracks + clips
		const { data: sourceTabs } = await db
			.from('challenge_tabs')
			.select('*')
			.eq('challenge_id', params.id)
			.order('position');

		for (const tab of sourceTabs ?? []) {
			const { data: newTab } = await db
				.from('challenge_tabs')
				.insert({
					challenge_id: newChallenge.id,
					position: tab.position,
					created_by: locals.user?.id ?? null
				})
				.select('id')
				.single();
			if (!newTab) continue;

			const [{ data: srcs }, { data: clipEntries }] = await Promise.all([
				db.from('challenge_tab_source_tracks').select('*').eq('tab_id', tab.id).order('sort_order'),
				db.from('challenge_tab_clips').select('*').eq('tab_id', tab.id).order('sort_order')
			]);

			if (srcs?.length) {
				await db
					.from('challenge_tab_source_tracks')
					.insert(
						srcs.map((s) => ({ tab_id: newTab.id, track_id: s.track_id, sort_order: s.sort_order }))
					);
			}
			if (clipEntries?.length) {
				await db.from('challenge_tab_clips').insert(
					clipEntries.map((c) => ({
						tab_id: newTab.id,
						clip_id: c.clip_id,
						fragment_number: c.fragment_number,
						sort_order: c.sort_order
					}))
				);
			}
		}

		// Copy answer options
		const { data: sourceOptions } = await db
			.from('answer_options')
			.select('field, value, input_mode')
			.eq('challenge_id', params.id);

		if (sourceOptions?.length) {
			await db.from('answer_options').insert(
				sourceOptions.map((ao) => ({
					challenge_id: newChallenge.id,
					field: ao.field,
					value: ao.value,
					input_mode: ao.input_mode,
					created_by: locals.user?.id ?? null
				}))
			);
		}

		redirect(303, `/admin/challenges/${newChallenge.id}`);
	},

	// ── Effect preset management ────────────────────────────────────────────────

	savePreset: async ({ request, locals }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const name = (data.get('name') as string)?.trim();
		const effects_json = data.get('effects_json') as string;

		if (!name) return fail(400, { error: 'Preset name is required' });
		if (!locals.user?.id) return fail(401, { error: 'Not authenticated' });

		let effects: unknown;
		try {
			effects = JSON.parse(effects_json);
		} catch {
			return fail(400, { error: 'Invalid effects JSON' });
		}

		const { error: e } = await db.from('effect_presets').insert({
			name,
			effects: effects as never,
			is_builtin: false,
			created_by: locals.user.id
		});
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'savePreset' };
	},

	updatePreset: async ({ request, locals }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const preset_id = data.get('preset_id') as string;
		const name = (data.get('name') as string)?.trim();

		if (!preset_id) return fail(400, { error: 'Missing preset_id' });
		if (!locals.user?.id) return fail(401, { error: 'Not authenticated' });
		if (!name) return fail(400, { error: 'Name is required' });

		const { error: e } = await db
			.from('effect_presets')
			.update({ name })
			.eq('id', preset_id)
			.eq('created_by', locals.user.id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'updatePreset' };
	},

	deletePreset: async ({ request, locals }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const preset_id = data.get('preset_id') as string;

		if (!preset_id) return fail(400, { error: 'Missing preset_id' });
		if (!locals.user?.id) return fail(401, { error: 'Not authenticated' });

		const { error: e } = await db
			.from('effect_presets')
			.delete()
			.eq('id', preset_id)
			.eq('created_by', locals.user.id)
			.eq('is_builtin', false);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'deletePreset' };
	}
};
