import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ params }) => {
	const db = createAdminClient();

	const { data: challenge, error: cErr } = await db
		.from('challenges')
		.select('*')
		.eq('id', params.id)
		.single();
	if (cErr || !challenge) error(404, 'Challenge not found');

	const [ctResult, tracksResult] = await Promise.all([
		db.from('challenge_tracks').select('*').eq('challenge_id', params.id).order('sort_order'),
		db.from('tracks').select('*').order('artist')
	]);

	const challengeTracks = ctResult.data ?? [];
	const allTracks = tracksResult.data ?? [];

	// Load clips for all tracks in the library (not just tracks already in this challenge)
	// so the clip dropdown populates when the admin picks any available track.
	const allTrackIds = allTracks.map((t) => t.id);
	const { data: clips } = await db.from('clips').select('*').in('track_id', allTrackIds.length ? allTrackIds : ['__none__']);

	// Load answer options for this challenge
	const { data: answerOptions } = await db.from('answer_options').select('*').eq('challenge_id', params.id);

	return {
		challenge,
		challengeTracks: challengeTracks,
		allTracks,
		clips: clips ?? [],
		answerOptions: answerOptions ?? []
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
		const pointsRaw = (data.get('points_config') as string)?.trim();
		const difficultyRaw = parseInt(data.get('difficulty_rating') as string, 10);
		const difficulty_rating = difficultyRaw >= 1 && difficultyRaw <= 5 ? difficultyRaw : 3;
		const speedRaw = (data.get('speed_threshold_seconds') as string | null)?.trim();
		const speed_threshold_seconds = speedRaw ? parseInt(speedRaw, 10) || null : null;
		const hint_text = (data.get('hint_text') as string | null)?.trim() || null;

		let points_config: object;
		try {
			points_config = JSON.parse(pointsRaw || '{}');
		} catch {
			return fail(400, { error: 'points_config must be valid JSON' });
		}

		if (!title) return fail(400, { error: 'Title is required' });

		const { error: e } = await db.from('challenges').update({
			title, stage_label, timer_seconds, variant: variant as never, points_config: points_config as never,
			difficulty_rating, speed_threshold_seconds, hint_text
		}).eq('id', params.id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'meta' };
	},

	setStatus: async ({ request, params }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const status = data.get('status') as string;
		if (!['draft', 'active', 'completed'].includes(status)) return fail(400, { error: 'Invalid status' });

		const { error: e } = await db.from('challenges').update({
			status,
			is_active: status === 'active'
		}).eq('id', params.id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'status' };
	},

	addTrack: async ({ request, params, locals }) => {
		const db = createAdminClient();
		const data = await request.formData();

		const track_id = data.get('track_id') as string;
		const clip_id = data.get('clip_id') as string;

		if (!track_id || !clip_id) return fail(400, { error: 'Select a track and clip' });

		// Get max sort_order
		const { data: existing } = await db
			.from('challenge_tracks')
			.select('sort_order')
			.eq('challenge_id', params.id)
			.order('sort_order', { ascending: false })
			.limit(1);

		const sort_order = (existing?.[0]?.sort_order ?? 0) + 1;

		const { error: e } = await db.from('challenge_tracks').insert({
			challenge_id: params.id, track_id, clip_id, sort_order,
			created_by: locals.user?.id ?? null
		});
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'addTrack' };
	},

	removeTrack: async ({ request, params }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const ct_id = data.get('ct_id') as string;
		if (!ct_id) return fail(400, { error: 'Missing challenge_track id' });

		const { error: e } = await db.from('challenge_tracks').delete().eq('id', ct_id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'removeTrack' };
	},

	reorderTrack: async ({ request, params }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const ct_id = data.get('ct_id') as string;
		const direction = data.get('direction') as 'up' | 'down';

		const { data: all } = await db
			.from('challenge_tracks')
			.select('id, sort_order')
			.eq('challenge_id', params.id)
			.order('sort_order');

		if (!all) return fail(500, { error: 'Could not load tracks' });

		const idx = all.findIndex((r) => r.id === ct_id);
		if (idx === -1) return fail(400, { error: 'Track not found' });

		const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
		if (swapIdx < 0 || swapIdx >= all.length) return { success: true, action: 'reorderTrack' };

		const [a, b] = [all[idx], all[swapIdx]];
		await Promise.all([
			db.from('challenge_tracks').update({ sort_order: b.sort_order }).eq('id', a.id),
			db.from('challenge_tracks').update({ sort_order: a.sort_order }).eq('id', b.id)
		]);
		return { success: true, action: 'reorderTrack' };
	},

	// Generate default answer options: correct answer + up to 7 distractors from other tracks
	generateOptions: async ({ request, params, locals }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const ct_id = data.get('ct_id') as string;
		const field = data.get('field') as string;

		if (!ct_id || !field) return fail(400, { error: 'Missing ct_id or field' });

		// Get the challenge_track with track details
		const { data: ct } = await db.from('challenge_tracks').select('track_id').eq('id', ct_id).single();
		if (!ct) return fail(400, { error: 'challenge_track not found' });

		const { data: track } = await db.from('tracks').select('*').eq('id', ct.track_id).single();
		if (!track) return fail(400, { error: 'Track not found' });

		type TrackKey = keyof typeof track;
		const correct = track[field as TrackKey];
		if (correct == null || correct === '') return fail(400, { error: `Track has no value for field "${field}"` });

		// Get up to 7 distinct distractors from other tracks
		const { data: others } = await db
			.from('tracks')
			.select(field)
			.neq('id', ct.track_id)
			.not(field, 'is', null)
			.limit(100);

		const distSet = new Set<string>();
		for (const r of others ?? []) {
			const v = String((r as unknown as Record<string, unknown>)[field] ?? '').trim();
			if (v && v !== String(correct)) distSet.add(v);
		}
		const distractors = [...distSet].sort(() => Math.random() - 0.5).slice(0, 7);
		const options = [String(correct), ...distractors].sort(() => Math.random() - 0.5);

		// Delete existing options for this challenge+field, then insert new ones
		await db.from('answer_options').delete().eq('challenge_id', params.id).eq('field', field as never);
		if (options.length > 0) {
			const { error: e } = await db.from('answer_options').insert(
				options.map((value) => ({ challenge_id: params.id, field: field as never, value, created_by: locals.user?.id ?? null }))
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

		const options = raw.split('\n').map((s) => s.trim()).filter(Boolean);

		await db.from('answer_options').delete().eq('challenge_id', params.id).eq('field', field as never);
		if (options.length > 0) {
			const { error: e } = await db.from('answer_options').insert(
				options.map((value) => ({ challenge_id: params.id, field: field as never, value, created_by: locals.user?.id ?? null }))
			);
			if (e) return fail(500, { error: e.message });
		}
		return { success: true, action: 'saveOptions' };
	},

	// Saves per-field input mode into challenge.points_config.field_modes.
	// We store here (not answer_options.input_mode) to avoid ambiguity with
	// the migration-default 'multiple_choice' that all existing rows carry.
	saveInputMode: async ({ request, params }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const field = data.get('field') as string;
		const mode = data.get('mode') as string;

		const VALID_MODES = ['multiple_choice', 'combobox', 'open_text', 'typeable_number', 'slider'];
		if (!field || !VALID_MODES.includes(mode)) return fail(400, { error: 'Invalid field or mode' });

		const { data: challenge } = await db.from('challenges').select('points_config').eq('id', params.id).single();
		if (!challenge) return fail(404, { error: 'Challenge not found' });

		const pc = (challenge.points_config ?? {}) as Record<string, unknown>;
		const fieldModes = ((pc.field_modes ?? {}) as Record<string, string>);
		fieldModes[field] = mode;

		const { error: e } = await db.from('challenges')
			.update({ points_config: { ...pc, field_modes: fieldModes } as never })
			.eq('id', params.id);
		if (e) return fail(500, { error: e.message });

		return { success: true, action: 'saveInputMode' };
	}
};
