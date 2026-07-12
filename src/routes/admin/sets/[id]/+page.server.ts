import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '$lib/server/supabase';
import { generateAssignmentSlots, TEAM_COLOR_ORDER } from '$lib/server/randomize';
import { awardCrownPayout } from '$lib/server/crown';
import { resetGameState } from '$lib/server/reset';
import { parseConfig, mergePowerupConfig } from '$lib/server/powerups';
import type {
	PowerupMode,
	PowerupTypeConsoleRow,
	PowerupTypeOverride,
	SetPowerupConfig,
	ThresholdConfig,
	TokenShopConfig
} from '$lib/types';

export const load: PageServerLoad = async ({ params }) => {
	const db = createAdminClient();
	const { id } = params;

	const [
		{ data: gameSet },
		{ data: setChallengesRaw },
		{ data: allChallenges },
		{ data: powerupTypesRaw }
	] = await Promise.all([
		db.from('game_sets').select('*').eq('id', id).maybeSingle(),
		db
			.from('set_challenges')
			.select('id, challenge_id, position, challenge_multiplier')
			.eq('set_id', id)
			.order('position'),
		db.from('challenges').select('id, title, variant, is_active, nfc_lock_override').order('title'),
		// Console powerup list source (piece 2): the real 7 runtime types + the
		// coming_soon placeholders (migration 0056), NOT the legacy powerups/
		// set_powerups catalog — that catalog is fully decorative, nothing in
		// the earning/activation runtime reads it.
		db.from('powerup_types').select('*').order('category').order('id')
	]);

	if (!gameSet) redirect(302, '/admin/sets');

	const setChallenges = setChallengesRaw ?? [];
	const challengeIds = setChallenges.map((sc) => sc.challenge_id);

	// Player count + recently joined (for console joining state)
	const [{ data: players }, unlockTagsResult] = await Promise.all([
		db
			.from('players')
			.select('id, display_name, created_at')
			.eq('set_id', id)
			.order('created_at', { ascending: false }),
		// Load challenge_unlock NFC tags for this set (purpose: challenge_unlock, set_id match)
		db
			.from('nfc_tags')
			.select('id, slug, challenge_id')
			.eq('purpose', 'challenge_unlock')
			.eq('set_id', id)
	]);

	const playerList = players ?? [];
	const playerCount = playerList.length;
	const playerIds = playerList.map((p) => p.id);
	const recentPlayers = playerList.slice(0, 5).map((p) => p.display_name);

	// Team progress (for console playing state)
	let teamProgress: Array<{ name: string; done: number; total: number }> = [];
	if (gameSet.play_state === 'playing' && challengeIds.length > 0) {
		const scopedColors = TEAM_COLOR_ORDER.slice(0, gameSet.team_count);
		const [{ data: teams }, { data: subs }] = await Promise.all([
			db.from('teams').select('id, display_name, color').in('color', scopedColors),
			db
				.from('submissions')
				.select('team_id, challenge_id')
				.eq('is_final', true)
				.in('challenge_id', challengeIds)
		]);
		const subsByTeam = new Map<string, number>();
		for (const s of subs ?? []) {
			if (s.team_id) subsByTeam.set(s.team_id, (subsByTeam.get(s.team_id) ?? 0) + 1);
		}
		teamProgress = (teams ?? [])
			.sort((a, b) => TEAM_COLOR_ORDER.indexOf(a.color) - TEAM_COLOR_ORDER.indexOf(b.color))
			.map((t) => ({
				name: t.display_name,
				done: subsByTeam.get(t.id) ?? 0,
				total: challengeIds.length
			}));
	}

	const challengeUnlockTags = (unlockTagsResult.data ?? []).map((t) => ({
		challenge_id: t.challenge_id ?? '',
		slug: t.slug
	}));

	const powerupMode: PowerupMode = (gameSet.powerup_mode as PowerupMode) ?? 'threshold';
	const rawConfig = gameSet.powerup_config;
	const powerupSetConfig: SetPowerupConfig =
		rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
			? (rawConfig as unknown as SetPowerupConfig)
			: { thresholds_percent: [25, 50, 75] };
	// v2-normalized config — source of truth for both the threshold_mode/band_mode
	// selects (piece 1) and the per-type/category overrides below (piece 2).
	const powerupConfigV2 = parseConfig(rawConfig);

	// Console powerup list (piece 2): the real 7 runtime types + coming_soon
	// placeholders, merged with their per-set override from
	// powerupConfigV2.types[id]. Replaces the legacy powerupConfigs
	// (powerups + set_powerups) as the console's data source.
	const powerupTypeRows: PowerupTypeConsoleRow[] = (powerupTypesRaw ?? []).map((p) => {
		const override = powerupConfigV2.types[p.id];
		return {
			id: p.id,
			name: p.name,
			category: p.category,
			description: p.description,
			icon: p.icon,
			enabled_by_default: p.enabled_by_default,
			coming_soon: p.coming_soon,
			default_min_score_pct: p.default_min_score_pct,
			default_max_score_pct: p.default_max_score_pct,
			is_inverse: override?.inverse ?? p.default_inverse,
			effective_enabled: override?.enabled ?? p.enabled_by_default,
			effective_threshold: override?.threshold ?? null,
			effective_chance: override?.chance ?? 1,
			has_override: !!override
		};
	});

	return {
		gameSet,
		setChallenges,
		allChallenges: allChallenges ?? [],
		playerCount,
		playerIds,
		recentPlayers,
		teamProgress,
		challengeUnlockTags,
		powerupTypeRows,
		powerupMode,
		powerupSetConfig,
		powerupConfigV2
	};
};

export const actions: Actions = {
	update: async ({ request, params }) => {
		const db = createAdminClient();
		const formData = await request.formData();
		const name = (formData.get('name') as string | null)?.trim() ?? '';
		const description = (formData.get('description') as string | null)?.trim() || null;
		const team_count = parseInt(formData.get('team_count') as string) || 6;
		const timer_raw = (formData.get('total_timer_minutes') as string | null)?.trim();
		const total_timer_seconds = timer_raw ? (parseInt(timer_raw) || 0) * 60 || null : null;
		const epc_raw = (formData.get('expected_player_count') as string | null)?.trim();
		const expected_player_count = epc_raw ? parseInt(epc_raw) || null : null;

		if (!name) return fail(400, { error: 'Name is required' });
		if (team_count < 2 || team_count > 6) return fail(400, { error: 'Team count must be 2–6' });

		const { error } = await db
			.from('game_sets')
			.update({ name, description, team_count, total_timer_seconds, expected_player_count })
			.eq('id', params.id);

		if (error) return fail(500, { error: 'Update failed' });
		return { success: true };
	},

	setChallenges: async ({ request, params, locals }) => {
		const db = createAdminClient();
		const formData = await request.formData();
		const raw = (formData.get('challenge_ids') as string | null) ?? '';
		const challengeIds = raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		let multipliersMap: Record<string, number> = {};
		try {
			multipliersMap = JSON.parse((formData.get('multipliers_json') as string | null) ?? '{}');
		} catch {
			/* ok */
		}

		let nfcSlugsMap: Record<string, string> = {};
		try {
			nfcSlugsMap = JSON.parse((formData.get('nfc_slugs_json') as string | null) ?? '{}');
		} catch {
			/* ok */
		}

		// Rebuild set_challenges atomically (delete + insert in one transaction via
		// RPC — a separate delete-then-insert left the set with zero challenges if
		// the insert failed after the delete had already committed).
		const rows = challengeIds.map((challenge_id, i) => ({
			challenge_id,
			position: i,
			// parseFloat (not parseInt) so half-steps like 1.5 / 2.5 survive.
			// DB CHECK enforces the 1–2.5 range; UI enforces the 0.5 step.
			challenge_multiplier: Math.max(
				1,
				parseFloat(String(multipliersMap[challenge_id] ?? 1)) || 1
			),
			created_by: locals.user?.id ?? null
		}));
		const { error: replaceError } = await (db as SupabaseClient).rpc('replace_set_challenges', {
			p_set_id: params.id,
			p_rows: rows
		});
		if (replaceError) return fail(500, { error: 'Could not save challenges' });

		// Update NFC unlock tags: remove old ones for this set, add new ones from nfcSlugsMap
		await db.from('nfc_tags').delete().eq('purpose', 'challenge_unlock').eq('set_id', params.id);
		const unlockTagRows = Object.entries(nfcSlugsMap)
			.filter(([, slug]) => slug.trim())
			.map(([challenge_id, slug]) => ({
				slug: slug.trim(),
				purpose: 'challenge_unlock' as const,
				challenge_id,
				set_id: params.id,
				created_by: locals.user?.id ?? null
			}));
		if (unlockTagRows.length > 0) {
			const userId = locals.user?.id ?? null;
			if (userId) {
				const slugsToCheck = unlockTagRows.map((r) => r.slug);
				const { data: conflicts } = await db
					.from('nfc_tags')
					.select('slug')
					.in('slug', slugsToCheck)
					.eq('created_by', userId);
				if (conflicts && conflicts.length > 0) {
					const s = conflicts[0].slug;
					return fail(400, {
						error: `Tag '${s}' already in use`,
						existingTagUrl: `/admin/nfc-tags?slug=${encodeURIComponent(s)}`
					});
				}
			}
			const { error } = await db.from('nfc_tags').insert(unlockTagRows);
			if (error) return fail(500, { error: `Could not save NFC unlock tags: ${error.message}` });
		}

		return { success: true };
	},

	toggle: async ({ params }) => {
		const db = createAdminClient();

		const { data: gameSet } = await db
			.from('game_sets')
			.select('id, status, team_count, expected_player_count')
			.eq('id', params.id)
			.maybeSingle();

		if (!gameSet) return fail(404, { error: 'Set not found' });

		if (gameSet.status === 'active') {
			const { error } = await db
				.from('game_sets')
				.update({ status: 'inactive', play_state: 'joining' })
				.eq('id', params.id);
			if (error) return fail(500, { error: 'Could not deactivate set' });
			return { success: true };
		} else {
			let assignment_slots: string[] = [];
			if (gameSet.expected_player_count && gameSet.expected_player_count > 0) {
				assignment_slots = await generateAssignmentSlots(
					db,
					gameSet.expected_player_count,
					gameSet.team_count
				);
			}
			const { error } = await db
				.from('game_sets')
				.update({
					status: 'active',
					play_state: 'joining',
					started_at: new Date().toISOString(),
					ended_at: null,
					recap_state: 'pending',
					recap_ranking: [] as never,
					recap_reveal_index: 0,
					assignment_slots: assignment_slots as never,
					assignment_index: 0
				})
				.eq('id', params.id);
			if (error) return fail(500, { error: 'Could not activate set' });
			redirect(303, `/admin/sets/${params.id}/lobby`);
		}
	},

	toggleNfcLock: async ({ params }) => {
		const db = createAdminClient();
		const { data: gs } = await db
			.from('game_sets')
			.select('nfc_lock_enabled')
			.eq('id', params.id)
			.maybeSingle();
		if (!gs) return fail(404, { error: 'Set not found' });
		await db
			.from('game_sets')
			.update({ nfc_lock_enabled: !gs.nfc_lock_enabled })
			.eq('id', params.id);
		return { success: true };
	},

	setTeamSelectionMode: async ({ request, params }) => {
		const db = createAdminClient();
		const fd = await request.formData();
		const mode = (fd.get('mode') as string | null)?.trim();
		if (mode !== 'random' && mode !== 'selectable')
			return fail(400, { error: 'Invalid team selection mode' });
		await db.from('game_sets').update({ team_selection_mode: mode }).eq('id', params.id);
		return { success: true };
	},

	startGame: async ({ params }) => {
		const db = createAdminClient();

		const { data: gameSet } = await db
			.from('game_sets')
			.select('id, status, play_state')
			.eq('id', params.id)
			.maybeSingle();

		if (!gameSet || gameSet.status !== 'active') return fail(400, { error: 'Set must be active' });
		if (gameSet.play_state !== 'joining') return fail(400, { error: 'Game already started' });

		const { error } = await db
			.from('game_sets')
			.update({ play_state: 'playing', started_at: new Date().toISOString() })
			.eq('id', params.id);

		if (error) return fail(500, { error: 'Could not start game' });
		redirect(303, `/admin/live`);
	},

	startRecap: async ({ params }) => {
		const db = createAdminClient();

		const { data: gameSet } = await db
			.from('game_sets')
			.select('id, status, play_state')
			.eq('id', params.id)
			.maybeSingle();

		if (!gameSet || gameSet.status !== 'active')
			return fail(400, { error: 'Set must be active to start recap' });
		if (gameSet.play_state === 'recap') return fail(400, { error: 'Recap already started' });

		const { error } = await db
			.from('game_sets')
			.update({ play_state: 'recap', recap_state: 'pending', ended_at: new Date().toISOString() })
			.eq('id', params.id);

		if (error) return fail(500, { error: 'Could not start recap' });

		// Award +2 to crown holder at game-end (idempotent)
		await awardCrownPayout(db, params.id);

		redirect(303, `/admin/sets/${params.id}/recap`);
	},

	resetGame: async ({ params }) => {
		const db = createAdminClient();
		// Full soft reset via the shared helper (crown/powerups/effects included) —
		// see src/lib/server/reset.ts. Keeping the logic in one place is what
		// prevents this action and the recap-page reset from drifting again.
		const { notFound, errors } = await resetGameState(db, params.id, 'console');
		if (notFound) return fail(404, { error: 'Set not found' });
		if (errors.length > 0) return fail(500, { error: `Reset failed: ${errors.join('; ')}` });
		return { success: true };
	},

	toggle_powerups_enabled: async ({ params }) => {
		const db = createAdminClient();
		const { data: gs } = await db
			.from('game_sets')
			.select('powerups_enabled')
			.eq('id', params.id)
			.maybeSingle();
		if (!gs) return fail(404, { error: 'Set not found' });
		await db
			.from('game_sets')
			.update({ powerups_enabled: !gs.powerups_enabled })
			.eq('id', params.id);
		return { success: true };
	},

	set_powerup_mode: async ({ request, params }) => {
		const db = createAdminClient();
		const fd = await request.formData();
		const mode = (fd.get('mode') as string | null)?.trim() as PowerupMode | null;
		if (mode !== 'threshold' && mode !== 'token_shop')
			return fail(400, { error: 'Invalid powerup mode' });

		const defaults: Record<PowerupMode, SetPowerupConfig> = {
			threshold: { thresholds_percent: [25, 50, 75] },
			token_shop: {
				starting_tokens: 0,
				per_correct_challenge: 1,
				streak_bonuses: [
					{ streak: 3, bonus: 2 },
					{ streak: 5, bonus: 5 }
				],
				time_tick_minutes: null,
				tokens_per_tick: 1
			}
		};

		const { error } = await db
			.from('game_sets')
			.update({ powerup_mode: mode, powerup_config: defaults[mode] as never })
			.eq('id', params.id);
		if (error) return fail(500, { error: 'Could not set powerup mode' });
		return { success: true };
	},

	save_powerup_config: async ({ request, params }) => {
		const db = createAdminClient();
		const fd = await request.formData();
		const mode = (fd.get('mode') as string | null)?.trim() as PowerupMode | null;

		let config: SetPowerupConfig;

		if (mode === 'threshold') {
			// Parse thresholds_percent_N values
			const percents: number[] = [];
			let i = 0;
			while (fd.has(`threshold_${i}`)) {
				const v = parseInt((fd.get(`threshold_${i}`) as string) ?? '');
				if (!isNaN(v) && v >= 1 && v <= 100) percents.push(v);
				i++;
			}
			// Deduplicate and sort ascending
			const sorted = [...new Set(percents)].sort((a, b) => a - b);
			if (sorted.length === 0) return fail(400, { error: 'At least one threshold is required' });
			const thresholdConfig: ThresholdConfig = { thresholds_percent: sorted };
			config = thresholdConfig;
		} else if (mode === 'token_shop') {
			const startingTokens = parseInt((fd.get('starting_tokens') as string) ?? '0') || 0;
			const perCorrect = parseInt((fd.get('per_correct_challenge') as string) ?? '1') || 0;
			const timeTick = (fd.get('time_tick_minutes') as string | null)?.trim();
			const timeTickMinutes = timeTick ? parseInt(timeTick) || null : null;
			const tokensPerTick = parseInt((fd.get('tokens_per_tick') as string) ?? '1') || 1;

			if (startingTokens < 0) return fail(400, { error: 'Starting tokens must be ≥ 0' });
			if (perCorrect < 0) return fail(400, { error: 'Per-challenge bonus must be ≥ 0' });
			if (timeTickMinutes !== null && timeTickMinutes < 1)
				return fail(400, { error: 'Time tick must be a positive number of minutes' });

			const streakBonuses: Array<{ streak: number; bonus: number }> = [];
			let i = 0;
			while (fd.has(`streak_streak_${i}`)) {
				const streak = parseInt((fd.get(`streak_streak_${i}`) as string) ?? '');
				const bonus = parseInt((fd.get(`streak_bonus_${i}`) as string) ?? '');
				if (!isNaN(streak) && streak >= 1 && !isNaN(bonus) && bonus >= 0) {
					streakBonuses.push({ streak, bonus });
				}
				i++;
			}
			const shopConfig: TokenShopConfig = {
				starting_tokens: startingTokens,
				per_correct_challenge: perCorrect,
				streak_bonuses: streakBonuses,
				time_tick_minutes: timeTickMinutes,
				tokens_per_tick: tokensPerTick
			};
			config = shopConfig;
		} else {
			return fail(400, { error: 'Invalid powerup mode' });
		}

		const { error } = await db
			.from('game_sets')
			.update({ powerup_config: config as never })
			.eq('id', params.id);
		if (error) return fail(500, { error: 'Could not save powerup config' });
		return { success: true };
	},

	// v2 config, piece 1 of the powerup-earning rebuild. Replaces the threshold
	// half of save_powerup_config above (which wholesale-overwrote powerup_config
	// and would silently destroy a hand-set earn_threshold or, later, the
	// types/categories subtrees). This action reads the current config, merges
	// only the threshold-ladder fields, and writes the merged v2 object back —
	// every sibling key survives. save_powerup_config is left in place for the
	// token_shop form (unchanged, out of scope for this piece).
	saveThresholds: async ({ request, params }) => {
		const db = createAdminClient();
		const fd = await request.formData();

		const percents: number[] = [];
		let i = 0;
		while (fd.has(`threshold_${i}`)) {
			const v = parseInt((fd.get(`threshold_${i}`) as string) ?? '');
			if (!isNaN(v) && v >= 1 && v <= 100) percents.push(v);
			i++;
		}
		const sorted = [...new Set(percents)].sort((a, b) => a - b);
		if (sorted.length === 0) return fail(400, { error: 'At least one threshold is required' });

		const thresholdMode =
			(fd.get('threshold_mode') as string | null) === 'cumulative' ? 'cumulative' : 'per_challenge';
		const bandMode =
			(fd.get('band_mode') as string | null) === 'highest_band' ? 'highest_band' : 'all_bands';

		const { data: gameSet } = await db
			.from('game_sets')
			.select('powerup_config')
			.eq('id', params.id)
			.maybeSingle();

		const current = parseConfig(gameSet?.powerup_config);
		const merged = mergePowerupConfig(current, {
			thresholds_percent: sorted,
			threshold_mode: thresholdMode,
			band_mode: bandMode
		});

		const { error } = await db
			.from('game_sets')
			.update({ powerup_config: merged as never })
			.eq('id', params.id);
		if (error) return fail(500, { error: 'Could not save thresholds' });
		return { success: true };
	},

	// v2 per-type config, piece 2. Replaces update_powerup_config's set_powerups
	// upsert — writes into powerup_config.types[type_id] instead (merge, not
	// replace, via mergePowerupConfig). Each control on the console submits its
	// own field independently (enabled / threshold / chance), so only the field
	// present in the request is touched — the others survive untouched.
	saveTypeConfig: async ({ request, params }) => {
		const db = createAdminClient();
		const fd = await request.formData();
		const typeId = (fd.get('type_id') as string | null)?.trim();
		if (!typeId) return fail(400, { error: 'Missing type_id' });

		const { data: type } = await db
			.from('powerup_types')
			.select('coming_soon')
			.eq('id', typeId)
			.maybeSingle();
		if (!type) return fail(400, { error: 'Unknown powerup type' });
		// Server-side guard: a coming_soon type has no runtime effect — never let
		// a crafted request enable/configure one, even if the console UI hides
		// the controls for it.
		if (type.coming_soon) return fail(400, { error: 'This powerup is not yet available' });

		const enabledRaw = fd.get('enabled') as string | null;
		const thresholdRaw = (fd.get('threshold') as string | null)?.trim();
		const chanceRaw = (fd.get('chance') as string | null)?.trim();

		const patch: PowerupTypeOverride = {};
		if (enabledRaw !== null) patch.enabled = enabledRaw === 'true';
		if (thresholdRaw) {
			const v = parseInt(thresholdRaw, 10);
			if (!isNaN(v) && v >= 0 && v <= 100) patch.threshold = v;
		}
		if (chanceRaw !== undefined && chanceRaw !== '') {
			// Console UI is a 0–100% input; stored as a 0–1 float.
			const pct = parseInt(chanceRaw, 10);
			if (!isNaN(pct) && pct >= 0 && pct <= 100) patch.chance = pct / 100;
		}

		const { data: gameSet } = await db
			.from('game_sets')
			.select('powerup_config')
			.eq('id', params.id)
			.maybeSingle();

		const current = parseConfig(gameSet?.powerup_config);
		const merged = mergePowerupConfig(current, {
			types: { [typeId]: { ...current.types[typeId], ...patch } }
		});

		const { error } = await db
			.from('game_sets')
			.update({ powerup_config: merged as never })
			.eq('id', params.id);
		if (error) return fail(500, { error: 'Could not save powerup config' });
		return { success: true };
	},

	// Category master toggle, piece 2. Replaces togglePowerupCategory's
	// set_powerups upsert — writes into powerup_config.categories[cat] instead.
	// Never touches coming_soon types (they have no working controls to enable).
	toggleCategory: async ({ request, params }) => {
		const db = createAdminClient();
		const fd = await request.formData();
		const category = (fd.get('category') as string | null)?.trim();
		const enabled = fd.get('enabled') === 'true';
		if (!category) return fail(400, { error: 'Missing category' });

		const { data: gameSet } = await db
			.from('game_sets')
			.select('powerup_config')
			.eq('id', params.id)
			.maybeSingle();

		const current = parseConfig(gameSet?.powerup_config);
		const merged = mergePowerupConfig(current, {
			categories: { [category]: enabled }
		});

		const { error } = await db
			.from('game_sets')
			.update({ powerup_config: merged as never })
			.eq('id', params.id);
		if (error) return fail(500, { error: error.message });
		return { success: true };
	},

	delete: async ({ params }) => {
		const db = createAdminClient();

		const { data: gameSet } = await db
			.from('game_sets')
			.select('status')
			.eq('id', params.id)
			.maybeSingle();
		if (gameSet?.status === 'active') return fail(400, { error: 'Cannot delete an active set' });

		await db.from('game_sets').delete().eq('id', params.id);
		redirect(303, '/admin/sets');
	},

	duplicateSet: async ({ params, locals }) => {
		const db = createAdminClient();

		const { data: source } = await db.from('game_sets').select('*').eq('id', params.id).single();
		if (!source) return fail(404, { error: 'Set not found' });

		const { data: newSet, error } = await db
			.from('game_sets')
			.insert({
				name: `${source.name} (copy)`,
				description: source.description,
				team_count: source.team_count,
				total_timer_seconds: source.total_timer_seconds,
				expected_player_count: source.expected_player_count,
				preset_slug: source.preset_slug,
				powerups_enabled: source.powerups_enabled,
				powerup_mode: source.powerup_mode,
				powerup_config: source.powerup_config as never,
				nfc_lock_enabled: source.nfc_lock_enabled,
				team_selection_mode: source.team_selection_mode,
				status: 'inactive',
				play_state: 'joining',
				started_at: null,
				ended_at: null,
				recap_state: 'pending',
				recap_ranking: [] as never,
				recap_reveal_index: 0,
				scores_hidden: false,
				assignment_slots: [] as never,
				assignment_index: 0,
				last_results: null,
				created_by: locals.user?.id ?? null
			})
			.select('id')
			.single();

		if (error || !newSet) return fail(500, { error: error?.message ?? 'Could not duplicate set' });

		const { data: sourceChallenges } = await db
			.from('set_challenges')
			.select('challenge_id, position, challenge_multiplier')
			.eq('set_id', params.id);
		if (sourceChallenges?.length) {
			await db.from('set_challenges').insert(
				sourceChallenges.map((c) => ({
					set_id: newSet.id,
					challenge_id: c.challenge_id,
					position: c.position,
					challenge_multiplier: c.challenge_multiplier,
					created_by: locals.user?.id ?? null
				}))
			);
		}

		const { data: sourcePowerups } = await db
			.from('set_powerups')
			.select('powerup_id, enabled, cost_override, visibility_override, effect_payload_override')
			.eq('set_id', params.id);
		if (sourcePowerups?.length) {
			await db.from('set_powerups').insert(
				sourcePowerups.map((p) => ({
					set_id: newSet.id,
					powerup_id: p.powerup_id,
					enabled: p.enabled,
					cost_override: p.cost_override,
					visibility_override: p.visibility_override,
					effect_payload_override: p.effect_payload_override as never
				}))
			);
		}

		redirect(303, `/admin/sets/${newSet.id}`);
	}
};
