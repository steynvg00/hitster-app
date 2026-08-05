// Group A verification — lucky_dice's roll and x_ray/free_tab's reveal resolution.
//
//   npm run bots:verify-group-a
//
// READ-ONLY. Part 1 is pure (no DB, no app). Part 2 issues SELECTs only: it drives
// resolveFreeAnswerValue — the REAL helper x_ray, free_tab and free_answer all
// share — against real challenges in the live database, which is the whole point:
// a restatement of the reveal rules would prove nothing about whether the three
// powerups actually resolve the same way.
//
// What each part proves:
//
//   1. rollDice never leaves [min,max] and hits BOTH ends, asserted at the
//      boundaries with a pinned rand rather than sampled and hoped for; and
//      resolveDiceRange reads the range out of powerup_config with 1–6 as the
//      fallback for missing/invalid values, so the range is a setting rather than
//      a constant.
//   2. Every cell x_ray or free_tab would request resolves through the same
//      function free_answer's single field goes through — including the refusal
//      paths (a field this tab does not have, a track with an empty column,
//      `grouping`), which are what the "skip the cell, keep the powerup" rule
//      depends on.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
	rollDice,
	resolveDiceRange,
	resolveFreeAnswerValue,
	parseRevealTargets,
	parseConfig,
	LUCKY_DICE_DEFAULT_MIN,
	LUCKY_DICE_DEFAULT_MAX
} from '../../src/lib/server/powerups';
import {
	resolveTabFields,
	fieldMapsFromResolved,
	getSourceTracksForTab,
	type TabSourceTrackRaw,
	type MashupSourceRaw,
	type TabClipData,
	type ClipRaw,
	type TrackData
} from '../../src/lib/server/scoring';
import { X_RAY_MAX_REVEALS } from '../../src/lib/powerups-meta';

// ── .env loader (only sets keys not already in the environment) ───────────────
function loadEnv() {
	try {
		const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
		for (const line of raw.split('\n')) {
			const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
			if (!m) continue;
			let val = m[2].trim();
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
				val = val.slice(1, -1);
			if (!(m[1] in process.env)) process.env[m[1]] = val;
		}
	} catch {
		/* no .env — rely on the real environment */
	}
}

// ── tiny assert harness ───────────────────────────────────────────────────────
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass ? JSON.stringify(got) : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
	});
	console.log(`  ${pass ? '✓' : '✗'} ${name}  ${checks[checks.length - 1].detail}`);
}

// ── 1. lucky_dice: the roll and its range ─────────────────────────────────────
function verifyDice() {
	console.log('\n── rollDice(min, max, rand) — pinned randomness ──────────────────');
	// rand is injectable precisely so these two are assertions, not samples.
	assert('rand=0 → the minimum', rollDice(1, 6, () => 0), 1);
	assert('rand→1 → the maximum', rollDice(1, 6, () => 0.999999999), 6);
	assert('rand=0.5 → the middle', rollDice(1, 6, () => 0.5), 4);
	assert('single-value range', rollDice(3, 3, () => 0.7), 3);
	assert('wide range, low end', rollDice(10, 100, () => 0), 10);
	assert('wide range, high end', rollDice(10, 100, () => 0.999999999), 100);

	// Distribution sanity with the REAL Math.random: every roll inside the range,
	// and both ends actually reachable (a fencepost error in the +1 shows up here).
	const seen = new Set<number>();
	let outOfRange = 0;
	for (let i = 0; i < 20000; i++) {
		const r = rollDice(1, 6);
		if (r < 1 || r > 6 || !Number.isInteger(r)) outOfRange++;
		seen.add(r);
	}
	assert('20000 rolls, none outside [1,6]', outOfRange, 0);
	assert(
		'all six faces reachable',
		[...seen].sort((a, b) => a - b),
		[1, 2, 3, 4, 5, 6]
	);

	console.log('\n── resolveDiceRange(config) — range is a SETTING, not a constant ──');
	const def = { min: LUCKY_DICE_DEFAULT_MIN, max: LUCKY_DICE_DEFAULT_MAX };
	assert('empty config → 1–6 fallback', resolveDiceRange(parseConfig({})), def);
	assert('legacy config → 1–6 fallback', resolveDiceRange(parseConfig({ earn_threshold: 70 })), def);
	assert(
		'configured range is honoured',
		resolveDiceRange(parseConfig({ types: { lucky_dice: { dice_min: 5, dice_max: 20 } } })),
		{ min: 5, max: 20 }
	);
	assert(
		'inverted range → fallback',
		resolveDiceRange(parseConfig({ types: { lucky_dice: { dice_min: 9, dice_max: 2 } } })),
		def
	);
	assert(
		'zero/negative min → fallback',
		resolveDiceRange(parseConfig({ types: { lucky_dice: { dice_min: 0, dice_max: 6 } } })),
		def
	);
	assert(
		'non-integer → fallback',
		resolveDiceRange(parseConfig({ types: { lucky_dice: { dice_min: 1.5, dice_max: 6 } } })),
		def
	);
	assert(
		'sibling override keys survive',
		resolveDiceRange(
			parseConfig({ types: { lucky_dice: { enabled: true, chance: 0.5, dice_min: 2, dice_max: 4 } } })
		),
		{ min: 2, max: 4 }
	);
}

// ── 2. x_ray / free_tab: reveal resolution against the live database ──────────

/** The (slot, field) cells of one tab — the target list free_tab posts. */
async function cellsForTab(
	db: SupabaseClient,
	challenge: { id: string; variant: string; points_config: unknown },
	tab: { id: string; position: number; mashup_id?: string | null; fields?: unknown },
	variantDefaultPoints: Record<string, number>
): Promise<Array<{ slotIndex: number; field: string }>> {
	const { fields } = fieldMapsFromResolved(
		resolveTabFields(
			tab as never,
			{ variant: challenge.variant, points_config: challenge.points_config } as never,
			variantDefaultPoints
		)
	);

	const [srcRes, tabClipRes] = await Promise.all([
		db.from('challenge_tab_source_tracks').select('*').eq('tab_id', tab.id).order('sort_order'),
		db.from('challenge_tab_clips').select('*').eq('tab_id', tab.id).order('sort_order')
	]);
	const sourceTrackRows = (srcRes.data ?? []) as TabSourceTrackRaw[];
	const tabClipRows = tabClipRes.data ?? [];

	const clipIds = [...new Set(tabClipRows.map((c) => c.clip_id))];
	const clipsRes = clipIds.length
		? await db.from('clips').select('id, track_id').in('id', clipIds)
		: { data: [] as { id: string; track_id: string }[] };
	const clips: ClipRaw[] = (clipsRes.data ?? []).map((c) => ({ id: c.id, track_id: c.track_id }));

	const mashupRes =
		challenge.variant === 'mashup' && tab.mashup_id
			? await db.from('mashup_sources').select('*').eq('mashup_id', tab.mashup_id).order('sort_order')
			: { data: [] as MashupSourceRaw[] };
	const mashupSources = (mashupRes.data ?? []) as MashupSourceRaw[];

	const trackIds = [
		...new Set(
			[
				...sourceTrackRows.map((s) => s.track_id),
				...mashupSources.map((s) => s.track_id),
				...clips.map((c) => c.track_id)
			].filter(Boolean)
		)
	];
	const tracksRes = trackIds.length
		? await db.from('tracks').select('*').in('id', trackIds)
		: { data: [] as unknown[] };
	const trackMap = new Map(
		((tracksRes.data ?? []) as unknown as TrackData[]).map((t) => [t.id, t])
	);

	const tabClipData: TabClipData[] = tabClipRows.map((c) => ({
		id: c.id,
		tabId: c.tab_id,
		clipId: c.clip_id,
		fragmentNumber: c.fragment_number,
		sortOrder: c.sort_order,
		trackId: clips.find((cl) => cl.id === c.clip_id)?.track_id
	}));

	const sources = getSourceTracksForTab(
		challenge.variant,
		{ id: tab.id, mashup_id: tab.mashup_id ?? null },
		sourceTrackRows,
		mashupSources,
		tabClipData,
		clips,
		trackMap
	);
	const slotCount = Math.max(sources.length, 1);

	const cells: Array<{ slotIndex: number; field: string }> = [];
	for (let si = 0; si < slotCount; si++) {
		for (const f of fields) {
			if (f === 'grouping') continue; // never offered, same as free_answer
			cells.push({ slotIndex: si, field: f as string });
		}
	}
	return cells;
}

async function verifyReveals(db: SupabaseClient) {
	console.log('\n── x_ray / free_tab reveal resolution (live, read-only) ──────────');

	// Prefer challenges that are actually in the active set; fall back to any
	// challenge that has tabs, so the probe still runs on a fresh database.
	const { data: activeSet } = await db
		.from('game_sets')
		.select('id, name')
		.eq('status', 'active')
		.limit(1)
		.maybeSingle();

	let challengeIds: string[] = [];
	if (activeSet) {
		const { data: sc } = await db
			.from('set_challenges')
			.select('challenge_id')
			.eq('set_id', activeSet.id)
			.order('position');
		challengeIds = (sc ?? []).map((r) => r.challenge_id as string);
		console.log(`  active set: ${activeSet.name} — ${challengeIds.length} challenges`);
	}
	if (!challengeIds.length) {
		const { data: any } = await db.from('challenges').select('id').limit(5);
		challengeIds = (any ?? []).map((r) => r.id as string);
		console.log(`  no active set — probing ${challengeIds.length} arbitrary challenges`);
	}

	let totalCells = 0;
	let resolvedCells = 0;
	let refusedCells = 0;
	// The invariant the whole design rests on: the address the server echoes back
	// is the address that was asked for. If this drifts, badges and pre-fills land
	// on the wrong tab/slot — the exact bug the free_answer pass fixed.
	let addressMismatches = 0;
	const refusalReasons = new Map<string, number>();

	for (const cid of challengeIds) {
		const { data: challenge } = await db
			.from('challenges')
			.select('id, title, variant, points_config')
			.eq('id', cid)
			.maybeSingle();
		if (!challenge) continue;

		const { data: tabRows } = await db
			.from('challenge_tabs')
			.select('*')
			.eq('challenge_id', cid)
			.order('position');
		const tabs = tabRows ?? [];
		if (!tabs.length) continue;

		const { data: vdRow } = await db
			.from('variant_defaults')
			.select('points_config')
			.eq('variant', challenge.variant)
			.maybeSingle();
		const variantDefaultPoints = ((vdRow?.points_config as Record<string, unknown> | null)
			?.field_points ?? {}) as Record<string, number>;

		console.log(
			`\n  ▸ ${challenge.title} [${challenge.variant}] — ${tabs.length} tab${tabs.length === 1 ? '' : 's'}`
		);

		for (const tab of tabs) {
			const cells = await cellsForTab(
				db,
				challenge as never,
				tab as never,
				variantDefaultPoints
			);
			// free_tab posts EVERY cell of the tab; x_ray posts at most five of them.
			const xRayCells = cells.slice(0, X_RAY_MAX_REVEALS);
			console.log(
				`    tab ${tab.position} (${(tab.id as string).slice(0, 8)}): free_tab would request ${cells.length} cells, x_ray up to ${xRayCells.length}`
			);

			for (const c of cells) {
				totalCells++;
				const r = await resolveFreeAnswerValue(
					db as never,
					cid,
					c.field,
					tab.id as string,
					c.slotIndex
				);
				if ('error' in r) {
					refusedCells++;
					refusalReasons.set(r.error, (refusalReasons.get(r.error) ?? 0) + 1);
					console.log(`      slot ${c.slotIndex} ${c.field.padEnd(13)} ✗ ${r.error}`);
				} else {
					resolvedCells++;
					if (r.tabId !== tab.id || r.slotIndex !== c.slotIndex) addressMismatches++;
					const tagNote = r.tags?.length ? `  tags=${JSON.stringify(r.tags)}` : '';
					console.log(
						`      slot ${c.slotIndex} ${c.field.padEnd(13)} → ${JSON.stringify(r.value)}${tagNote}  [tab ${(r.tabId as string).slice(0, 8)} slot ${r.slotIndex}]`
					);
				}
			}
		}
	}

	console.log(
		`\n  ${totalCells} cells probed — ${resolvedCells} resolved, ${refusedCells} refused (skipped by x_ray/free_tab, powerup kept when ALL of a run refuse)`
	);
	for (const [reason, n] of refusalReasons) console.log(`    ${n}× ${reason}`);

	assert('every resolved cell echoed its own (tab, slot)', addressMismatches, 0);
	assert('reveal resolution actually exercised', resolvedCells > 0, true);
	if (totalCells === 0) {
		console.log('  ⚠ no challenges with tabs found — reveal resolution NOT exercised');
	}
}

// ── 3. parseRevealTargets: the form → address-list door (pure) ────────────────
function verifyTargetParsing() {
	console.log('\n── parseRevealTargets(formData) ──────────────────────────────────');
	const fd = (v?: string) => {
		const f = new FormData();
		if (v !== undefined) f.set('reveal_targets', v);
		return f;
	};
	assert('missing field → {}', parseRevealTargets(fd()), {});
	assert('empty string → {}', parseRevealTargets(fd('')), {});
	assert('malformed JSON → {}', parseRevealTargets(fd('{nope')), {});
	assert('non-array JSON → {}', parseRevealTargets(fd('{"field":"artist"}')), {});
	assert(
		'well-formed list parses',
		parseRevealTargets(fd('[{"tabId":"t1","slotIndex":2,"field":"artist"}]')),
		{ revealTargets: [{ tabId: 't1', slotIndex: 2, field: 'artist' }] }
	);
	assert(
		'entries without a field are dropped',
		parseRevealTargets(fd('[{"tabId":"t1","slotIndex":0},{"tabId":"t1","slotIndex":1,"field":"year"}]')),
		{ revealTargets: [{ tabId: 't1', slotIndex: 1, field: 'year' }] }
	);
	assert(
		'missing slotIndex defaults to slot 0',
		parseRevealTargets(fd('[{"tabId":"t1","field":"title"}]')),
		{ revealTargets: [{ tabId: 't1', slotIndex: 0, field: 'title' }] }
	);
}

async function main() {
	loadEnv();
	verifyDice();
	verifyTargetParsing();

	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		console.log('\n⚠ No PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — skipping the live part.');
	} else {
		const db = createClient(url, key, { auth: { persistSession: false } });
		await verifyReveals(db);
	}

	const failed = checks.filter((c) => !c.pass);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	if (failed.length) {
		for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
		process.exit(1);
	}
}

main();
