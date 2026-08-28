// Laadt een set precies zoals de submit-pipeline hem ziet — via de ECHTE
// resolvers (resolveTabFields, getSourceTracksForTab, scoreTab) — en past
// optioneel de twee bekende datafouten virtueel toe zodat de simulatie op de
// "gefixte" set draait terwijl de database nog niet gefixt is.
//
// READ-ONLY. Alleen SELECT via PostgREST; geen enkele schrijfactie.
// Kan ook uit een JSON-dump lezen (--dump), zodat een run zonder netwerk kan.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	resolveChallengeFields,
	resolveTabFields,
	fieldMapsFromResolved,
	resolveArtistBonus,
	getSourceTracksForTab,
	scoreTab,
	type TrackData,
	type TabInput,
	type TabClipData,
	type TabSourceTrackRaw,
	type MashupSourceRaw,
	type ClipRaw
} from '../../../src/lib/server/scoring';
import { parseBattleConfig } from '../../../src/lib/battle-ranking';
import type { PowerupType } from '../../../src/lib/server/powerups';
import type { LoadedChallenge, LoadedSet } from './types';

type Dump = {
	set: Record<string, unknown>;
	setChallenges: Array<Record<string, unknown>>;
	challenges: Array<Record<string, unknown>>;
	tabs: Array<Record<string, unknown>>;
	srcTracks: TabSourceTrackRaw[];
	tabClips: Array<Record<string, unknown>>;
	mashupSources: MashupSourceRaw[];
	clips: Array<{ id: string; track_id: string }>;
	tracks: TrackData[];
	variantDefaults: Array<Record<string, unknown>>;
	powerupTypes: PowerupType[];
};

function readEnv(): Record<string, string> {
	const path = resolve(process.cwd(), '.env');
	return Object.fromEntries(
		readFileSync(path, 'utf8')
			.split('\n')
			.filter((l) => l.includes('=') && !l.startsWith('#'))
			.map((l) => {
				const i = l.indexOf('=');
				return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
			})
	);
}

export async function fetchDump(setId: string): Promise<Dump> {
	const env = readEnv();
	const sb = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
		auth: { persistSession: false }
	});
	const q = async <T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
		const { data, error } = await p;
		if (error) throw new Error(error.message);
		return data as T;
	};
	const set = await q<Record<string, unknown>>(
		sb.from('game_sets').select('*').eq('id', setId).single()
	);
	const setChallenges = await q<Array<Record<string, unknown>>>(
		sb.from('set_challenges').select('*').eq('set_id', setId).order('position')
	);
	const chIds = setChallenges.map((s) => s.challenge_id as string);
	const challenges = await q<Array<Record<string, unknown>>>(
		sb.from('challenges').select('*').in('id', chIds)
	);
	const tabs = await q<Array<Record<string, unknown>>>(
		sb.from('challenge_tabs').select('*').in('challenge_id', chIds).order('position')
	);
	const tabIds = tabs.map((t) => t.id as string);
	const srcTracks = await q<TabSourceTrackRaw[]>(
		sb.from('challenge_tab_source_tracks').select('*').in('tab_id', tabIds)
	);
	const tabClips = await q<Array<Record<string, unknown>>>(
		sb.from('challenge_tab_clips').select('*').in('tab_id', tabIds)
	);
	const mashupIds = [
		...new Set(tabs.map((t) => t.mashup_id as string | null).filter(Boolean))
	] as string[];
	const mashupSources = mashupIds.length
		? await q<MashupSourceRaw[]>(sb.from('mashup_sources').select('*').in('mashup_id', mashupIds))
		: [];
	const clipIds = [...new Set(tabClips.map((c) => c.clip_id as string))];
	const clips = clipIds.length
		? await q<Array<{ id: string; track_id: string }>>(
				sb.from('clips').select('id, track_id').in('id', clipIds)
			)
		: [];
	const trackIds = [
		...new Set([
			...srcTracks.map((s) => s.track_id),
			...mashupSources.map((s) => s.track_id),
			...clips.map((c) => c.track_id)
		])
	];
	const tracks = trackIds.length
		? await q<TrackData[]>(sb.from('tracks').select('*').in('id', trackIds))
		: [];
	const variantDefaults = await q<Array<Record<string, unknown>>>(
		sb.from('variant_defaults').select('*')
	);
	const powerupTypes = await q<PowerupType[]>(
		sb.from('powerup_types').select('*').order('sort_order')
	);
	return {
		set,
		setChallenges,
		challenges,
		tabs,
		srcTracks,
		tabClips,
		mashupSources,
		clips,
		tracks,
		variantDefaults,
		powerupTypes
	};
}

export function saveDump(dump: Dump, path: string) {
	writeFileSync(path, JSON.stringify(dump, null, 1));
}

export function readDump(path: string): Dump {
	return JSON.parse(readFileSync(path, 'utf8')) as Dump;
}

/**
 * De twee bekende datafouten, virtueel. Doet in het geheugen wat
 * /tmp/fix-tab-positions.sql in de database doet:
 *   - dubbele tabposities hernummeren (op position, created_at, id)
 *   - een brontrack die twee keer op dezelfde tab staat één keer tellen
 */
export function applyKnownFixes(dump: Dump): string[] {
	const applied: string[] = [];
	const byCh = new Map<string, Array<Record<string, unknown>>>();
	for (const t of dump.tabs) {
		const l = byCh.get(t.challenge_id as string) ?? [];
		l.push(t);
		byCh.set(t.challenge_id as string, l);
	}
	for (const [chId, list] of byCh) {
		const positions = list.map((t) => t.position as number);
		if (new Set(positions).size === positions.length) continue;
		list.sort(
			(a, b) =>
				(a.position as number) - (b.position as number) ||
				String(a.created_at).localeCompare(String(b.created_at)) ||
				String(a.id).localeCompare(String(b.id))
		);
		list.forEach((t, i) => (t.position = i));
		const title = dump.challenges.find((c) => c.id === chId)?.title;
		applied.push(`tabposities hernummerd: ${title}`);
	}
	const seen = new Set<string>();
	const before = dump.srcTracks.length;
	dump.srcTracks = dump.srcTracks
		.slice()
		.sort((a, b) => a.sort_order - b.sort_order)
		.filter((s) => {
			const k = `${s.tab_id}:${s.track_id}`;
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		});
	if (dump.srcTracks.length !== before)
		applied.push(`dubbele brontrack op één tab verwijderd (${before - dump.srcTracks.length})`);
	return applied;
}

export type FieldOverride = { challengeTitleIncludes: string; field: string; max_points: number };

/**
 * Bouw de LoadedSet. `fieldOverrides` past max_points van een veld aan vóór het
 * resolven (de "bonusvelden verlaagd"-variant), zonder de dump te muteren.
 */
export function buildSet(
	dumpIn: Dump,
	opts: { fixes: boolean; fieldOverrides?: FieldOverride[] }
): LoadedSet {
	const dump: Dump = JSON.parse(JSON.stringify(dumpIn));
	const fixesApplied = opts.fixes ? applyKnownFixes(dump) : [];

	for (const ov of opts.fieldOverrides ?? []) {
		for (const ch of dump.challenges) {
			if (!String(ch.title).includes(ov.challengeTitleIncludes)) continue;
			const pc = (ch.points_config ?? {}) as Record<string, unknown>;
			const fields = Array.isArray(pc.fields) ? (pc.fields as Array<Record<string, unknown>>) : [];
			for (const f of fields) if (f.name === ov.field) f.max_points = ov.max_points;
			ch.points_config = { ...pc, fields };
		}
	}

	const trackMap = new Map<string, TrackData>(dump.tracks.map((t) => [t.id, t]));
	const clips: ClipRaw[] = dump.clips.map((c) => ({ id: c.id, track_id: c.track_id }));
	const allTabClipData: TabClipData[] = dump.tabClips.map((c) => ({
		id: c.id as string,
		tabId: c.tab_id as string,
		clipId: c.clip_id as string,
		fragmentNumber: (c.fragment_number as number | null) ?? null,
		sortOrder: c.sort_order as number,
		trackId: clips.find((cl) => cl.id === c.clip_id)?.track_id
	}));
	const vdPoints = new Map<string, Record<string, number>>();
	const streakByVariant: Record<string, Array<{ streak: number; bonus: number }>> = {};
	for (const vd of dump.variantDefaults) {
		const pc = (vd.points_config as { field_points?: Record<string, number> } | null) ?? {};
		vdPoints.set(vd.variant as string, pc.field_points ?? {});
		const sc =
			(vd.streak_config as { thresholds?: Array<{ streak: number; bonus: number }> } | null) ??
			null;
		streakByVariant[vd.variant as string] = sc?.thresholds ?? [];
	}

	const challenges: LoadedChallenge[] = dump.setChallenges.map((sc) => {
		const ch = dump.challenges.find((c) => c.id === sc.challenge_id)!;
		const variant = ch.variant as string;
		const pc = (ch.points_config ?? {}) as Record<string, unknown>;
		const vdp = vdPoints.get(variant) ?? {};
		const tabsRaw = dump.tabs
			.filter((t) => t.challenge_id === ch.id)
			.sort((a, b) => (a.position as number) - (b.position as number));
		let thresholdMax = 0;
		let maxTotal = 0;
		const tabs: TabInput[] = tabsRaw.map((tab) => {
			const srcs = getSourceTracksForTab(
				variant,
				{ id: tab.id as string, mashup_id: tab.mashup_id as string | null },
				dump.srcTracks,
				dump.mashupSources,
				allTabClipData,
				clips,
				trackMap
			);
			const tabClipItems = allTabClipData.filter((c) => c.tabId === tab.id);
			const fieldMaps = fieldMapsFromResolved(
				resolveTabFields({ fields: tab.fields }, { variant, points_config: pc }, vdp)
			);
			const m = scoreTab(
				fieldMaps.fields,
				fieldMaps.fieldModes,
				fieldMaps.fieldPoints,
				srcs,
				tabClipItems,
				[],
				fieldMaps.bonusFields
			);
			thresholdMax += m.tabThresholdMax;
			maxTotal += m.tabMaxTotal;
			return {
				tabId: tab.id as string,
				tabPosition: tab.position as number,
				sourceTracks: srcs,
				clips: tabClipItems,
				playerDraft: [],
				fieldMaps
			};
		});
		const { fields, fieldModes, fieldPoints, bonusFields } = fieldMapsFromResolved(
			resolveChallengeFields(variant, pc, vdp)
		);
		return {
			id: ch.id as string,
			title: ch.title as string,
			variant,
			position: sc.position as number,
			points_config: pc,
			difficulty_rating: (ch.difficulty_rating as number | null) ?? 3,
			speed_threshold_seconds: (ch.speed_threshold_seconds as number | null) ?? null,
			timer_seconds: (ch.timer_seconds as number | null) ?? null,
			challenge_multiplier: (sc.challenge_multiplier as number | null) ?? 1,
			battle: parseBattleConfig(pc),
			tabs,
			fields,
			fieldModes,
			fieldPoints,
			bonusFields,
			artistBonus: resolveArtistBonus(pc),
			thresholdMax,
			maxTotal
		};
	});

	return {
		id: dump.set.id as string,
		name: dump.set.name as string,
		teamCount: (dump.set.team_count as number) ?? 6,
		hardGaanWindowMinutes: (dump.set.hard_gaan_window_minutes as number) ?? 15,
		powerupsEnabled: dump.set.powerups_enabled === true,
		rawPowerupConfig: dump.set.powerup_config,
		challenges,
		powerupTypes: dump.powerupTypes,
		streakThresholdsByVariant: streakByVariant,
		fixesApplied
	};
}
