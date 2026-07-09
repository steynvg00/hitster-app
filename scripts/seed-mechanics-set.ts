// Seed ONE feature-dense mechanics-test game set, idempotently, in a single
// command — so it can be rebuilt after every reset.
//
//   npm run seed:mechanics [-- --reset]
//
// Self-contained: seeds its own dummy tracks (NO audio — bots don't listen).
// Every challenge is single-track standard/label/anthem so the bots can actually
// play it and exercise real scoring. It does NOT seed mashup/fragments/multi-tab
// (bots can't drive those).
//
// Idempotent via fixed UUIDs: re-running upserts in place (no duplicates).
// --reset deletes the prior mechanics-test rows first (FK cascades do the rest).
//
// Uses the service-role key from .env (never hardcoded). Playability note: a
// challenge renders + is scorable with just a challenge_tabs row + a
// challenge_tab_source_tracks row — NO clip/audio row is required (the page load
// only hard-errors on a missing challenge or missing tabs; the Waveform tolerates
// an empty src). So we seed no clips.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
		/* no .env — rely on the real environment */
	}
}

// ── Stable UUIDs (valid v4 shape) so re-runs upsert in place ──────────────────
const NS = 'e5100000-0000-4000-8000-0000000000';
const uid = (n: number) => `${NS}${n.toString(16).padStart(2, '0')}`;
const SET_ID = uid(0x01);
const trackId = (i: number) => uid(0x10 + i);
const challengeId = (i: number) => uid(0x20 + i);
const tabId = (i: number) => uid(0x30 + i);
const srcId = (i: number) => uid(0x40 + i);
const setChId = (i: number) => uid(0x50 + i);

const SET_NAME = '🧪 Mechanics Test';

// ── Dummy tracks (no audio) ───────────────────────────────────────────────────
interface SeedTrack {
	artist: string;
	title: string;
	year: number;
	record_label?: string;
	festival?: string;
}
const TRACKS: SeedTrack[] = [
	{ artist: 'Neon Circuit', title: 'Voltage', year: 2015 },
	{ artist: 'Bass Reactor', title: 'Overdrive', year: 2011 },
	{ artist: 'Pulse Theory', title: 'Frequency', year: 2019 },
	{ artist: 'Vinyl Sons', title: 'Analog Dream', year: 2008, record_label: 'Scantraxx' },
	{ artist: 'Anthem Kings', title: 'Rise Up', year: 2013, festival: 'Defqon.1' },
	{ artist: 'Multiplier', title: 'Triple Threat', year: 2017 }
];

// ── Challenges — one per feature axis ─────────────────────────────────────────
interface SeedChallenge {
	variant: 'standard' | 'label' | 'anthem';
	track: number;
	title: string;
	field_modes: Record<string, string>;
	difficulty_rating: number;
	challenge_multiplier: number;
	speed_threshold_seconds?: number;
	tests: string;
}
const CHALLENGES: SeedChallenge[] = [
	{
		variant: 'standard',
		track: 0,
		title: '1 · Open text (neutral difficulty)',
		field_modes: { artist: 'open_text', title: 'open_text', year: 'open_text' },
		difficulty_rating: 3,
		challenge_multiplier: 1,
		tests: 'neutral difficulty 1.0× · all open_text fuzzy scoring'
	},
	{
		variant: 'standard',
		track: 1,
		title: '2 · Combobox + slider (hard, 1.67×)',
		field_modes: { artist: 'combobox', title: 'open_text', year: 'slider' },
		difficulty_rating: 5,
		challenge_multiplier: 1,
		tests: 'combobox artist (needs pool) + year slider + difficulty 1.67×'
	},
	{
		variant: 'standard',
		track: 2,
		title: '3 · Typeable number (easy, 0.33×)',
		field_modes: { artist: 'open_text', title: 'open_text', year: 'typeable_number' },
		difficulty_rating: 1,
		challenge_multiplier: 1,
		tests: 'typeable_number year + difficulty 0.33×'
	},
	{
		variant: 'label',
		track: 3,
		title: '4 · Label combobox (record_label scoring)',
		field_modes: { label: 'combobox', artist: 'open_text', title: 'open_text', year: 'open_text' },
		difficulty_rating: 3,
		challenge_multiplier: 1,
		tests: 'label variant · record_label scored via combobox (needs pool)'
	},
	{
		variant: 'anthem',
		track: 4,
		title: '5 · Anthem festival + speed bonus',
		field_modes: {
			festival: 'combobox',
			artist: 'open_text',
			title: 'open_text',
			year: 'open_text'
		},
		difficulty_rating: 3,
		challenge_multiplier: 1,
		speed_threshold_seconds: 300,
		tests: 'anthem festival combobox (needs pool) + generous speed threshold → +5 speed bonus'
	},
	{
		variant: 'standard',
		track: 5,
		title: '6 · Round multiplier ×3',
		field_modes: { artist: 'open_text', title: 'open_text', year: 'open_text' },
		difficulty_rating: 3,
		challenge_multiplier: 3,
		tests: 'set_challenges.challenge_multiplier ×3 (round multiplier)'
	}
];

const TIMER_SECONDS = 90; // enables the lazy bot's host-side auto-submit
const EARN_THRESHOLD = 60; // low so powerup earning fires in a test
const POOL_TABLE: Record<'artist' | 'label' | 'festival', string> = {
	artist: 'answer_pool_artists',
	label: 'answer_pool_labels',
	festival: 'answer_pool_festivals'
};

// Resolve a real host user id the same way dev-auth does (FK → auth.users).
async function resolveHostUserId(db: SupabaseClient): Promise<string | null> {
	const [{ data: wl }, { data: list }] = await Promise.all([
		db.from('host_whitelist').select('email, is_super_admin'),
		db.auth.admin.listUsers()
	]);
	const users = list?.users ?? [];
	if (!users.length) return null;
	const superE = new Set((wl ?? []).filter((r) => r.is_super_admin).map((r) => r.email.toLowerCase()));
	const anyE = new Set((wl ?? []).map((r) => r.email.toLowerCase()));
	const envE = new Set(
		(process.env.SUPER_ADMIN_EMAILS ?? '')
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean)
	);
	const emailOf = (u: { email?: string }) => u.email?.toLowerCase() ?? '';
	const pick =
		users.find((u) => superE.has(emailOf(u))) ??
		users.find((u) => anyE.has(emailOf(u))) ??
		users.find((u) => envE.has(emailOf(u))) ??
		users[0];
	return pick.id;
}

async function must<T>(label: string, p: Promise<{ error: { message: string } | null; data: T }>): Promise<T> {
	const { error, data } = await p;
	if (error) throw new Error(`${label}: ${error.message}`);
	return data;
}

async function main() {
	const reset = process.argv.includes('--reset');
	loadEnv();
	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error('Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
	const db = createClient(url, key, { auth: { persistSession: false } });

	const createdBy = await resolveHostUserId(db);
	if (!createdBy) console.warn('⚠  No auth.users found — owned inserts will have created_by = null');

	// ── --reset: delete prior rows (FK cascades handle children) ─────────────
	if (reset) {
		console.log('↺ --reset: clearing prior mechanics-test rows…');
		// challenges → cascades tabs, source_tracks, submissions, attempts, set_challenges
		await must('reset challenges', db.from('challenges').delete().in('id', CHALLENGES.map((_, i) => challengeId(i))).select());
		// game_set → cascades set_challenges (set side), nulls players.set_id, powerup rows
		await must('reset game_set', db.from('game_sets').delete().eq('id', SET_ID).select());
		await must('reset tracks', db.from('tracks').delete().in('id', TRACKS.map((_, i) => trackId(i))).select());
	}

	// ── Tracks ────────────────────────────────────────────────────────────────
	const trackRows = TRACKS.map((t, i) => ({
		id: trackId(i),
		artist: t.artist,
		title: t.title,
		year: t.year,
		record_label: t.record_label ?? null,
		festival: t.festival ?? null,
		accepted_titles: [t.title],
		created_by: createdBy
	}));
	await must('upsert tracks', db.from('tracks').upsert(trackRows).select());
	console.log(`✓ ${trackRows.length} dummy tracks`);

	// ── Game set ────────────────────────────────────────────────────────────
	await must(
		'upsert game_set',
		db
			.from('game_sets')
			.upsert({
				id: SET_ID,
				name: SET_NAME,
				description: 'Feature-dense mechanics test — rebuilt via npm run seed:mechanics',
				team_count: 4,
				team_selection_mode: 'random',
				status: 'active',
				play_state: 'joining',
				powerups_enabled: true,
				powerup_config: { earn_threshold: EARN_THRESHOLD },
				nfc_lock_enabled: false,
				scores_hidden: false,
				crown_holder_team_id: null,
				created_by: createdBy
			})
			.select()
	);
	console.log(`✓ game set "${SET_NAME}" (team_count 4, powerups on @ ${EARN_THRESHOLD}%)`);

	// ── Challenges + tabs + source tracks + set_challenges ───────────────────
	for (let i = 0; i < CHALLENGES.length; i++) {
		const c = CHALLENGES[i];
		await must(
			`upsert challenge ${i}`,
			db
				.from('challenges')
				.upsert({
					id: challengeId(i),
					variant: c.variant,
					title: c.title,
					status: 'active',
					is_active: true,
					timer_seconds: TIMER_SECONDS,
					difficulty_rating: c.difficulty_rating,
					speed_threshold_seconds: c.speed_threshold_seconds ?? null,
					points_config: { field_modes: c.field_modes },
					created_by: createdBy
				})
				.select()
		);
		await must(
			`upsert tab ${i}`,
			db
				.from('challenge_tabs')
				.upsert({ id: tabId(i), challenge_id: challengeId(i), position: 0, created_by: createdBy })
				.select()
		);
		await must(
			`upsert source track ${i}`,
			db
				.from('challenge_tab_source_tracks')
				.upsert({ id: srcId(i), tab_id: tabId(i), track_id: trackId(c.track), sort_order: 0 })
				.select()
		);
		await must(
			`upsert set_challenge ${i}`,
			db
				.from('set_challenges')
				.upsert({
					id: setChId(i),
					set_id: SET_ID,
					challenge_id: challengeId(i),
					position: i,
					challenge_multiplier: c.challenge_multiplier,
					created_by: createdBy
				})
				.select()
		);
		console.log(`✓ ${c.title}  — ${c.tests}`);
	}

	// ── Ensure combobox pools (idempotent; name is UNIQUE) ──────────────────
	const pool: Record<'artist' | 'label' | 'festival', Set<string>> = {
		artist: new Set(),
		label: new Set(),
		festival: new Set()
	};
	for (const c of CHALLENGES) {
		const t = TRACKS[c.track];
		if (c.field_modes.artist === 'combobox') pool.artist.add(t.artist);
		if (c.field_modes.label === 'combobox' && t.record_label) pool.label.add(t.record_label);
		if (c.field_modes.festival === 'combobox' && t.festival) pool.festival.add(t.festival);
	}
	for (const field of ['artist', 'label', 'festival'] as const) {
		const values = [...pool[field]].filter(Boolean);
		if (!values.length) continue;
		const { error } = await db
			.from(POOL_TABLE[field])
			.upsert(values.map((name) => ({ name })), { onConflict: 'name', ignoreDuplicates: true });
		if (error) console.warn(`  ⚠ ${POOL_TABLE[field]}: ${error.message}`);
		else console.log(`  ➕ ${POOL_TABLE[field]}: ensured ${values.join(', ')}`);
	}

	// ── Done ────────────────────────────────────────────────────────────────
	console.log(`\n✅ Mechanics Test set ready: ${SET_ID}`);
	console.log('\nNext (generate fixtures, then run the bots):');
	console.log(
		`  npm run bots:fixtures -- --set ${SET_ID} --ensure-pool && ` +
			`npm run bots:play -- --set ${SET_ID} --count 4 --profiles ace,mid,sloppy,lazy`
	);
	console.log('\nThen start the game as host (play_state → playing) when the bots say they have joined.');
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
