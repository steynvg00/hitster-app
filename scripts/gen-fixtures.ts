// DB-driven fixtures generator for the play bots.
//
//   npm run bots:fixtures -- --set <uuid> [--ensure-pool]
//
// Reads a game set's challenges, resolves each single-track challenge's source
// track (reusing getSourceTracksForTab), and writes the full ground truth to
// tests/bots/fixtures/<setId>.json. mashup / fragments / multi-tab challenges
// are skipped with a log.
//
// --ensure-pool idempotently inserts each correct artist/label/festival into the
// matching answer_pool_* table so the bots' combobox answers can confirm.
//
// Uses the service-role key from .env (never hardcode). This is a throwaway dev
// tool — it lives in scripts/ (outside src/) and never enters the app bundle.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
	getSourceTracksForTab,
	type TabSourceTrackRaw,
	type TrackData
} from '../src/lib/server/scoring.ts';

// ── .env loader (only sets keys not already in the environment) ───────────────
function loadEnv() {
	try {
		const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
		for (const line of raw.split('\n')) {
			const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
			if (!m) continue;
			let val = m[2].trim();
			if (
				(val.startsWith('"') && val.endsWith('"')) ||
				(val.startsWith("'") && val.endsWith("'"))
			) {
				val = val.slice(1, -1);
			}
			if (!(m[1] in process.env)) process.env[m[1]] = val;
		}
	} catch {
		/* no .env file — rely on the real environment */
	}
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function flagValue(name: string): string | undefined {
	const argv = process.argv;
	const idx = argv.indexOf(name);
	if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
	return argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

const HANDLED = new Set(['standard', 'label', 'anthem', 'effects']);
const POOL_TABLE: Record<'artist' | 'label' | 'festival', string> = {
	artist: 'answer_pool_artists',
	label: 'answer_pool_labels',
	festival: 'answer_pool_festivals'
};

interface OutFields {
	artist: string;
	title: string;
	year: number;
	record_label?: string;
	festival?: string;
}
interface OutChallenge {
	id: string;
	variant: string;
	fields: OutFields;
	accepted_titles?: string[];
}

async function main() {
	const setId = flagValue('--set');
	if (!setId) throw new Error('Missing required --set <uuid>\nUsage: npm run bots:fixtures -- --set <uuid> [--ensure-pool]');
	const ensurePool = process.argv.includes('--ensure-pool');

	loadEnv();
	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		throw new Error('Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
	}
	const db = createClient(url, key, { auth: { persistSession: false } });

	// set_challenges → challenges (ordered)
	const { data: sc, error: scErr } = await db
		.from('set_challenges')
		.select('challenge_id, position')
		.eq('set_id', setId)
		.order('position');
	if (scErr) throw scErr;
	if (!sc?.length) throw new Error(`No challenges found in set ${setId}`);

	const chIds = sc.map((r) => r.challenge_id as string);
	const { data: challenges } = await db.from('challenges').select('id, variant, title').in('id', chIds);
	const chMap = new Map((challenges ?? []).map((c) => [c.id as string, c]));

	// tabs + source tracks + tracks
	const { data: tabs } = await db.from('challenge_tabs').select('*').in('challenge_id', chIds).order('position');
	const tabsByCh = new Map<string, Array<{ id: string; mashup_id: string | null }>>();
	for (const t of tabs ?? []) {
		const arr = tabsByCh.get(t.challenge_id) ?? [];
		arr.push({ id: t.id, mashup_id: t.mashup_id });
		tabsByCh.set(t.challenge_id, arr);
	}

	const tabIds = (tabs ?? []).map((t) => t.id as string);
	const { data: srcRows } = tabIds.length
		? await db.from('challenge_tab_source_tracks').select('*').in('tab_id', tabIds).order('sort_order')
		: { data: [] as TabSourceTrackRaw[] };
	const trackIds = [...new Set((srcRows ?? []).map((s) => s.track_id as string))];
	const { data: trackRows } = trackIds.length
		? await db.from('tracks').select('*').in('id', trackIds)
		: { data: [] as TrackData[] };
	const trackMap = new Map<string, TrackData>((trackRows ?? []).map((t) => [t.id, t as TrackData]));

	// ── Resolve each challenge ──────────────────────────────────────────────
	const out: OutChallenge[] = [];
	const pool: Record<'artist' | 'label' | 'festival', Set<string>> = {
		artist: new Set(),
		label: new Set(),
		festival: new Set()
	};

	for (const { challenge_id } of sc) {
		const ch = chMap.get(challenge_id as string);
		if (!ch) continue;
		const variant = ch.variant as string;

		if (!HANDLED.has(variant)) {
			console.log(`  ⤼ ${ch.title} (${variant}): deferred variant — skipped`);
			continue;
		}
		const chTabs = tabsByCh.get(challenge_id as string) ?? [];
		if (chTabs.length !== 1) {
			console.log(`  ⤼ ${ch.title} (${variant}): ${chTabs.length} tabs (multi-tab) — skipped`);
			continue;
		}
		const tab = chTabs[0];
		const resolved = getSourceTracksForTab(
			variant,
			{ id: tab.id, mashup_id: tab.mashup_id },
			(srcRows ?? []) as TabSourceTrackRaw[],
			[],
			[],
			[],
			trackMap
		);
		if (resolved.length !== 1) {
			console.log(`  ⤼ ${ch.title} (${variant}): ${resolved.length} source tracks — skipped`);
			continue;
		}

		const track = resolved[0].track;
		const fields: OutFields = { artist: track.artist, title: track.title, year: track.year };
		if (track.record_label) fields.record_label = track.record_label;
		if (track.festival) fields.festival = track.festival;
		const accepted = track.accepted_titles?.length ? track.accepted_titles : undefined;

		out.push({ id: challenge_id as string, variant, fields, accepted_titles: accepted });
		console.log(`  ✓ ${ch.title} (${variant}): ${track.artist} — ${track.title} (${track.year})`);

		// Combobox pool candidates: artist for every variant; label/festival scoped.
		if (track.artist) pool.artist.add(track.artist);
		if (variant === 'label' && track.record_label) pool.label.add(track.record_label);
		if (variant === 'anthem' && track.festival) pool.festival.add(track.festival);
	}

	// ── Write fixtures ──────────────────────────────────────────────────────
	const outPath = resolve(process.cwd(), `tests/bots/fixtures/${setId}.json`);
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, JSON.stringify({ setId, challenges: out }, null, 2) + '\n');
	console.log(`\n📝 Wrote ${out.length} challenge(s) → ${outPath}`);

	// ── Ensure combobox pools (idempotent; name is UNIQUE) ──────────────────
	if (ensurePool) {
		for (const field of ['artist', 'label', 'festival'] as const) {
			const values = [...pool[field]].filter(Boolean);
			if (!values.length) continue;
			const { error } = await db
				.from(POOL_TABLE[field])
				.upsert(values.map((name) => ({ name })), { onConflict: 'name', ignoreDuplicates: true });
			if (error) console.warn(`  ⚠ ${POOL_TABLE[field]}: ${error.message}`);
			else console.log(`  ➕ ${POOL_TABLE[field]}: ensured ${values.length} value(s)`);
		}
	} else if (out.length) {
		console.log('  (run with --ensure-pool to insert correct combobox values into the answer pools)');
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
