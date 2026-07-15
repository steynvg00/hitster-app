import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { CHALLENGE_TYPES } from '$lib/variants';
import {
	resolveChallengeFields,
	resolveArtistBonus,
	FIELD_POOL_TABLE
} from '$lib/server/scoring.js';
import { parseBattleConfig } from '$lib/battle-ranking';

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

	const userPresets =
		challenge.variant === 'effects'
			? ((
					await db
						.from('effect_presets')
						.select('*')
						.eq('is_builtin', false)
						.eq('created_by', locals.user?.id ?? '')
						.order('created_at')
				).data ?? [])
			: [];

	// Single source of truth for which fields this challenge has, seeding the
	// fields editor from either the saved points_config.fields[] or — when none
	// exists yet — the variant's default fields (bit-identical to today's
	// TYPE_FIELDS[variant] behavior). Route through the SAME resolver the
	// scoring pipeline uses so the editor never drifts from what actually scores.
	const { data: vdRow } = await db
		.from('variant_defaults')
		.select('points_config')
		.eq('variant', challenge.variant)
		.maybeSingle();
	const variantDefaultPoints = ((vdRow?.points_config as Record<string, unknown> | null)
		?.field_points ?? {}) as Record<string, number>;
	const resolvedFields = resolveChallengeFields(
		challenge.variant,
		challenge.points_config,
		variantDefaultPoints
	);
	const poolBackedFields = Object.keys(FIELD_POOL_TABLE);

	// Battle mode (stuk 2): same single-source-of-truth discipline as resolvedFields
	// above — parseBattleConfig is the SAME parser resolveBattle reads at
	// resolution, so the editor can never drift from what actually resolves.
	const battleConfig = parseBattleConfig(challenge.points_config);

	// Artist bonus (C1 stuk 2) — read through resolveArtistBonus, the SAME resolver
	// the scorer uses, so the editor can't show a marking that won't actually score.
	const artistBonus = resolveArtistBonus(challenge.points_config);
	// Suggestions for the bonus name field. Nice-to-have: the host can type any
	// name (a challenge spans tabs with different tracks, and a name that matches
	// no track simply no-ops — that's stuk 1's model).
	const { data: artistPoolRows } = await db
		.from('answer_pool_artists')
		.select('name')
		.order('name');

	return {
		challenge,
		resolvedFields,
		poolBackedFields,
		battleConfig,
		artistBonus,
		artistPool: (artistPoolRows ?? []).map((r) => r.name),
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
		const timerRaw = (data.get('timer_seconds') as string | null)?.trim();
		const timer_seconds = timerRaw ? parseInt(timerRaw, 10) || 60 : null;
		const variant = data.get('variant') as string;
		const difficultyRaw = parseInt(data.get('difficulty_rating') as string, 10);
		const difficulty_rating = difficultyRaw >= 1 && difficultyRaw <= 5 ? difficultyRaw : 3;
		const speedRaw = (data.get('speed_threshold_seconds') as string | null)?.trim();
		const speed_threshold_seconds = speedRaw ? parseInt(speedRaw, 10) || null : null;
		const hint_text = (data.get('hint_text') as string | null)?.trim() || null;
		const nfcOverrideRaw = data.get('nfc_lock_override') as string | null;
		const nfc_lock_override =
			nfcOverrideRaw === 'true' ? true : nfcOverrideRaw === 'false' ? false : null;

		if (!title) return fail(400, { error: 'Title is required' });
		if (!variant || !(CHALLENGE_TYPES as readonly string[]).includes(variant)) {
			return fail(400, { error: 'Invalid type' });
		}

		// points_config is owned entirely by saveFields (fields[]) — this form has no
		// field-config inputs, so it must not touch that column at all. Omitting it
		// from the update leaves it untouched (previously this rebuilt points_config
		// from an always-empty field_points[] scan of THIS form's own data — a latent
		// bug that wiped field_points to {} on every "Save details" click).
		const { error: e } = await db
			.from('challenges')
			.update({
				title,
				stage_label,
				timer_seconds,
				variant: variant as never,
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

	// Multi-clip ordering (C2 — normal-tab multi-clip). Swaps a clip with its
	// up/down neighbour by CURRENT sort_order position, then renumbers the whole
	// tab 0..N-1 sequentially. Renumbering (rather than swapping the two raw
	// sort_order values) sidesteps any pre-existing duplicate sort_order — old
	// single-clip tabs were all inserted at sort_order 0 by setTabClip — self-
	// healing them into a clean, gap-free order the moment they're first reordered.
	// No unique constraint on (tab_id, sort_order), so the per-row update loop
	// below never collides even transiently.
	moveTabClip: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const tab_id = data.get('tab_id') as string;
		const tc_id = data.get('tc_id') as string;
		const direction = data.get('direction') as string | null;
		if (!tab_id || !tc_id || (direction !== 'up' && direction !== 'down')) {
			return fail(400, { error: 'Missing tab_id, tc_id, or direction' });
		}

		const { data: rows, error: selErr } = await db
			.from('challenge_tab_clips')
			.select('id')
			.eq('tab_id', tab_id)
			.order('sort_order', { ascending: true });
		if (selErr) return fail(500, { error: selErr.message });

		const ids = (rows ?? []).map((r) => r.id as string);
		const idx = ids.indexOf(tc_id);
		if (idx === -1) return fail(400, { error: 'Clip not found in tab' });

		const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
		if (swapIdx < 0 || swapIdx >= ids.length) {
			// Already at the boundary — a no-op, not an error (the UI disables the
			// button here, but a stale form submit should still succeed quietly).
			return { success: true, action: 'moveTabClip' };
		}
		[ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];

		for (let i = 0; i < ids.length; i++) {
			const { error: e } = await db
				.from('challenge_tab_clips')
				.update({ sort_order: i })
				.eq('id', ids[i]);
			if (e) return fail(500, { error: e.message });
		}
		return { success: true, action: 'moveTabClip' };
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

	// Configurable fields (stuk 2): merge-save the whole points_config.fields[]
	// array as one unit — a JSONB array can't be safely edited key-by-key the way
	// field_modes/field_points were, so the client holds the full array in local
	// state (add/remove/reorder/edit) and debounces a save of the entire thing,
	// same auto-persist pattern as saveTabEffects.
	saveFields: async ({ request, params }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const raw = data.get('fields_json') as string | null;
		if (raw == null) return fail(400, { error: 'Missing fields_json' });

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return fail(400, { error: 'Invalid fields JSON' });
		}
		if (!Array.isArray(parsed)) return fail(400, { error: 'fields must be an array' });

		// Server-side validation mirrors resolveChallengeFields's constraints —
		// never trust the wire, even though the client UI already enforces these.
		const KNOWN_FIELDS = [
			'artist',
			'title',
			'year',
			'label',
			'festival',
			'vocal_source',
			'grouping'
		];
		const VALID_MODES = ['multiple_choice', 'combobox', 'open_text', 'typeable_number', 'slider'];
		const poolBackedFields = new Set(Object.keys(FIELD_POOL_TABLE));
		const seen = new Set<string>();
		const cleaned: Array<{
			name: string;
			input_mode: string;
			max_points: number;
			is_bonus: boolean;
		}> = [];
		for (const row of parsed) {
			if (!row || typeof row !== 'object') continue;
			const name = (row as Record<string, unknown>).name;
			if (typeof name !== 'string' || !KNOWN_FIELDS.includes(name) || seen.has(name)) continue;
			seen.add(name);
			const modeRaw = (row as Record<string, unknown>).input_mode;
			let input_mode =
				typeof modeRaw === 'string' && VALID_MODES.includes(modeRaw) ? modeRaw : 'open_text';
			// combobox is backed by a shared answer pool (artist/label/festival) — any
			// other field falls back to open_text, same as the client-side guard.
			if (input_mode === 'combobox' && !poolBackedFields.has(name)) input_mode = 'open_text';
			const pointsRaw = (row as Record<string, unknown>).max_points;
			const max_points =
				typeof pointsRaw === 'number' && Number.isFinite(pointsRaw) ? pointsRaw : 10;
			const is_bonus = (row as Record<string, unknown>).is_bonus === true;
			cleaned.push({ name, input_mode, max_points, is_bonus });
		}

		const { data: existing } = await db
			.from('challenges')
			.select('points_config')
			.eq('id', params.id)
			.single();
		const existingPc = (existing?.points_config ?? {}) as Record<string, unknown>;

		// Read-modify-write: spread fields[] over the existing points_config,
		// never wholesale-replace (same trap as the powerup-config merge fix).
		const points_config = { ...existingPc, fields: cleaned };

		const { error: e } = await db
			.from('challenges')
			.update({ points_config: points_config as never })
			.eq('id', params.id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'saveFields' };
	},

	// Artist bonus (C1 stuk 2): merge-save points_config.artist_bonus = { name: pts }.
	// Name-keyed, matching what the scorer's resolveArtistBonus reads — a challenge
	// spans tabs with DIFFERENT tracks, so an index would be ambiguous across them,
	// and a name that matches no track on a given tab simply no-ops there.
	// Same read-modify-write discipline as saveFields — points_config also carries
	// fields[]/field_modes/field_points/battle, which must survive untouched.
	saveArtistBonus: async ({ request, params }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const raw = data.get('artist_bonus_json') as string | null;
		if (raw == null) return fail(400, { error: 'Missing artist_bonus_json' });

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return fail(400, { error: 'Invalid artist bonus JSON' });
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return fail(400, { error: 'artist_bonus must be an object' });
		}

		// Server-side validation mirrors resolveArtistBonus's constraints — never
		// trust the wire, even though the client already enforces these. Anything it
		// would silently drop is rejected here rather than stored as dead config.
		const cleaned: Record<string, number> = {};
		for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
			const trimmed = typeof name === 'string' ? name.trim() : '';
			if (!trimmed) continue;
			const pts = typeof value === 'number' ? value : Number(value);
			if (!Number.isFinite(pts) || pts <= 0) continue;
			cleaned[trimmed] = Math.round(pts);
		}

		const { data: existing } = await db
			.from('challenges')
			.select('points_config')
			.eq('id', params.id)
			.single();
		const existingPc = (existing?.points_config ?? {}) as Record<string, unknown>;

		const points_config = { ...existingPc, artist_bonus: cleaned };

		const { error: e } = await db
			.from('challenges')
			.update({ points_config: points_config as never })
			.eq('id', params.id);
		if (e) return fail(500, { error: e.message });
		return { success: true, action: 'saveArtistBonus' };
	},

	// Battle mode (stuk 2): merge-save points_config.battle = { enabled, max_points }.
	// The ladder is no longer stored — it's derived at resolution time from
	// max_points + the set's real team_count (see deriveLadder in battle-ranking.ts).
	// Same read-modify-write discipline as saveFields — points_config also carries
	// fields[]/field_modes/field_points, which must survive untouched.
	saveBattle: async ({ request, params }) => {
		const db = createAdminClient();
		const data = await request.formData();

		const enabled = data.get('enabled') === 'true';
		const maxPointsRaw = data.get('max_points') as string | null;
		if (maxPointsRaw == null) return fail(400, { error: 'Missing max_points' });

		// Server-side validation mirrors the client's — never trust the wire.
		const maxPointsParsed = parseInt(maxPointsRaw, 10);
		if (!Number.isFinite(maxPointsParsed) || maxPointsParsed < 0) {
			return fail(400, { error: 'max_points must be a non-negative integer' });
		}
		const max_points = Math.round(maxPointsParsed);

		const { data: existing } = await db
			.from('challenges')
			.select('points_config')
			.eq('id', params.id)
			.single();
		const existingPc = (existing?.points_config ?? {}) as Record<string, unknown>;

		// Read-modify-write: spread battle over the existing points_config, never
		// wholesale-replace (same trap as saveFields / the powerup-config merge fix).
		const points_config = { ...existingPc, battle: { enabled, max_points } };

		const { error: e2 } = await db
			.from('challenges')
			.update({ points_config: points_config as never })
			.eq('id', params.id);
		if (e2) return fail(500, { error: e2.message });
		return { success: true, action: 'saveBattle' };
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
