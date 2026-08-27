/**
 * SPELERSFLOW-SCREENSHOTSIMULATIE — herbruikbaar, op telefoonformaat.
 *
 *   npm run sim:screenshots                       # 390x844, alle momenten
 *   npm run sim:screenshots -- --viewport 375x667 --only 03,09,10 --label 375x667
 *
 * Loopt de volledige spelersflow door in WebKit op iPhone-formaat en legt op
 * exact veertien momenten een screenshot vast. Het script BEOORDEELT niets — het
 * levert de opnames plus een run-log met per moment: gehaald ja/nee, waar
 * gewacht of geforceerd moest worden, en wat niet reproduceerbaar was.
 *
 * ── Grondregels ──────────────────────────────────────────────────────────────
 *  · ELKE staatswijziging loopt via de app zelf: de spelerspagina's in de
 *    browser en de bestaande hostacties op /admin/sets/[id] (in dev is de host
 *    automatisch ingelogd, zie hooks.server.ts). Er wordt GEEN SQL geschreven en
 *    er draaien GEEN migraties.
 *  · De directe DB-toegang hieronder is UITSLUITEND lezend: het script leest de
 *    goede antwoorden (dezelfde weg die scripts/gen-fixtures.ts al gebruikt) en
 *    de recap-teller, zodat het weet wanneer een moment bereikt is.
 *  · Er wordt standaard NIETS gereset. `resetGameState` (de in-app reset) gooit
 *    ook de teamfoto's weg — onomkeerbaar — dus die zit achter een expliciete
 *    vlag. `--soft-reset` is het fotoveilige alternatief.
 *
 * ── Vlaggen ──────────────────────────────────────────────────────────────────
 *   --set <uuid>        Doelset. Default: de actieve set.
 *   --out <dir>         Uitvoermap. Default /tmp/sim-screenshots.
 *   --viewport WxH      Default 390x844.
 *   --label <tekst>     Achtervoegsel in de bestandsnaam (bv. 375x667).
 *   --only 03,09,10     Alleen deze momenten vastleggen (de flow loopt wél door).
 *   --base-url <url>    Default http://localhost:5173.
 *   --soft-reset        Fotoveilig: set deactiveren+activeren en teamscores op 0
 *                       via /admin/teams. Verwijdert GEEN teamfoto's.
 *   --hard-reset        De in-app reset van de set. LET OP: WIST TEAMFOTO'S.
 *   --purge-sim-players Ruimt achtergebleven simulatiespelers op via /api/player/leave.
 *   --keep-state        Zet de set na afloop NIET terug op `joining`.
 */

import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { webkit, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
	getSourceTracksForTab,
	type TabSourceTrackRaw,
	type TrackData
} from '../src/lib/server/scoring.ts';

/* ══════════════════════════════════════════════════════════════════════════
   CLI + omgeving
   ══════════════════════════════════════════════════════════════════════════ */

function flag(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
		return process.argv[i + 1];
	}
	return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const has = (name: string) => process.argv.includes(`--${name}`);

function loadEnv() {
	try {
		const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
		for (const line of raw.split('\n')) {
			const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
			if (!m) continue;
			let v = m[2].trim();
			if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
				v = v.slice(1, -1);
			}
			if (!(m[1] in process.env)) process.env[m[1]] = v;
		}
	} catch {
		/* geen .env — dan de echte omgeving */
	}
}

const BASE_URL = flag('base-url') ?? 'http://localhost:5173';
const OUT_DIR = flag('out') ?? '/tmp/sim-screenshots';
const LABEL = flag('label') ?? '';
const ONLY = flag('only')
	?.split(',')
	.map((s) => s.trim())
	.filter(Boolean);
const [VW, VH] = (flag('viewport') ?? '390x844').split('x').map((n) => parseInt(n, 10));

/**
 * Resterende hoogte met een open iOS-toetsenbord. WebKit onder Playwright kent
 * geen softwaretoetsenbord, dus moment 10 wordt benaderd door het venster tot
 * deze hoogte te krimpen — zie het rapportregel bij dat moment.
 */
const KEYBOARD_LEFTOVER: Record<number, number> = { 844: 508, 667: 363 };

/* ══════════════════════════════════════════════════════════════════════════
   Run-log — voedt het rapport
   ══════════════════════════════════════════════════════════════════════════ */

type ShotLog = {
	id: string;
	file: string | null;
	hit: boolean;
	waits: string[];
	forced: string[];
	note: string;
};
const log: ShotLog[] = [];
const notes: string[] = [];

function record(entry: ShotLog) {
	log.push(entry);
	const mark = entry.hit ? '✓' : '✗';
	console.log(`  ${mark} ${entry.id}  ${entry.file ?? '(niet vastgelegd)'}  ${entry.note}`);
}

/* ══════════════════════════════════════════════════════════════════════════
   Screenshot-helper
   ══════════════════════════════════════════════════════════════════════════ */

const wanted = (id: string) => !ONLY || ONLY.includes(id);

function fileName(id: string, slug: string, extra = ''): string {
	const parts = [id, slug];
	if (extra) parts.push(extra);
	const name = parts.join('-') + (LABEL ? `--${LABEL}` : '') + '.png';
	return join(OUT_DIR, name);
}

type Clip = { x: number; y: number; width: number; height: number };

async function shoot(
	page: Page,
	id: string,
	slug: string,
	opts: {
		fullPage?: boolean;
		clip?: Clip;
		/** Tweede opname zonder clip, om de schermranden te kunnen beoordelen. */
		alsoViewport?: boolean;
		verify: () => Promise<boolean>;
		waits?: string[];
		forced?: string[];
		note?: string;
	}
): Promise<string | null> {
	if (!wanted(id)) return null;

	let hit = false;
	try {
		hit = await opts.verify();
	} catch (err) {
		notes.push(`${id}: verificatie wierp een fout — ${(err as Error).message}`);
	}

	const file = fileName(id, slug);
	await page.screenshot({
		path: file,
		fullPage: opts.fullPage ?? false,
		...(opts.clip ? { clip: opts.clip } : {})
	});

	if (opts.alsoViewport) {
		await page.screenshot({ path: fileName(id, slug, 'viewport'), fullPage: false });
	}

	record({
		id,
		file,
		hit,
		waits: opts.waits ?? [],
		forced: opts.forced ?? [],
		note: opts.note ?? (hit ? 'moment bevestigd via DOM-controle' : 'DOM-controle NIET bevestigd')
	});
	return file;
}

/* ══════════════════════════════════════════════════════════════════════════
   Hostacties — de bestaande form-actions op /admin, in dev auto-geauthenticeerd
   ══════════════════════════════════════════════════════════════════════════ */

async function hostAction(ctx: BrowserContext, path: string, action: string) {
	const res = await ctx.request.post(`${BASE_URL}${path}?/${action}`, {
		form: { _sim: '1' },
		maxRedirects: 5
	});
	if (!res.ok() && res.status() !== 303) {
		throw new Error(`hostactie ${action} faalde: HTTP ${res.status()}`);
	}
}

/* ══════════════════════════════════════════════════════════════════════════
   Leesbare DB-toegang (alleen SELECT)
   ══════════════════════════════════════════════════════════════════════════ */

type Db = SupabaseClient;

async function readSetState(db: Db, setId: string) {
	const { data } = await db
		.from('game_sets')
		.select(
			'id, name, status, play_state, team_count, recap_state, recap_reveal_index, recap_ranking, battle_reveal_index, nfc_lock_enabled'
		)
		.eq('id', setId)
		.single();
	return data as {
		id: string;
		name: string;
		status: string;
		play_state: string;
		team_count: number;
		recap_state: string | null;
		recap_reveal_index: number | null;
		recap_ranking: string[] | null;
		battle_reveal_index: number | null;
		nfc_lock_enabled: boolean | null;
	};
}

/**
 * De hoogste score per opgeslagen battle-ranglijst, in onthulvolgorde
 * (set_challenges.position). Voedt de keuze welke battle moment 12 laat zien.
 */
async function readBattleScores(db: Db, setId: string): Promise<number[]> {
	const { data } = await db
		.from('set_challenges')
		.select('position, battle_ranking')
		.eq('set_id', setId)
		.not('battle_ranking', 'is', null)
		.order('position');
	return (data ?? []).map((r) => {
		const ranking = (r.battle_ranking ?? []) as Array<{ score?: number }>;
		return Math.max(0, ...ranking.map((e) => e.score ?? 0));
	});
}

/** Alles wat het script over de challenges van de set moet weten. */
type ChallengePlan = {
	id: string;
	title: string;
	variant: string;
	tabCount: number;
	battle: boolean;
	timer: number | null;
	/** Correcte waarden voor tab 0, voor zover af te leiden. */
	truth: { artist?: string; title?: string; year?: number } | null;
	playedByTeams: string[];
};

async function planChallenges(db: Db, setId: string): Promise<ChallengePlan[]> {
	const { data: sc } = await db
		.from('set_challenges')
		.select('challenge_id, position')
		.eq('set_id', setId)
		.order('position');
	const ids = (sc ?? []).map((r) => r.challenge_id as string);
	if (!ids.length) return [];

	const [{ data: chs }, { data: tabs }, { data: subs }] = await Promise.all([
		db
			.from('challenges')
			.select('id, title, variant, status, timer_seconds, points_config')
			.in('id', ids),
		db
			.from('challenge_tabs')
			.select('id, challenge_id, position, mashup_id')
			.in('challenge_id', ids)
			.order('position'),
		db.from('submissions').select('challenge_id, team_id').in('challenge_id', ids)
	]);

	const tabIds = (tabs ?? []).map((t) => t.id as string);
	const { data: srcRows } = tabIds.length
		? await db
				.from('challenge_tab_source_tracks')
				.select('*')
				.in('tab_id', tabIds)
				.order('sort_order')
		: { data: [] as TabSourceTrackRaw[] };
	const trackIds = [...new Set((srcRows ?? []).map((s) => s.track_id as string))];
	const { data: trackRows } = trackIds.length
		? await db.from('tracks').select('*').in('id', trackIds)
		: { data: [] as TrackData[] };
	const trackMap = new Map<string, TrackData>(
		(trackRows ?? []).map((t) => [t.id as string, t as TrackData])
	);

	const out: ChallengePlan[] = [];
	for (const row of sc ?? []) {
		const c = (chs ?? []).find((x) => x.id === row.challenge_id);
		if (!c || c.status !== 'active') continue;

		const myTabs = (tabs ?? []).filter((t) => t.challenge_id === c.id);
		const firstTab = myTabs[0];
		let truth: ChallengePlan['truth'] = null;
		if (firstTab) {
			const resolved = getSourceTracksForTab(
				c.variant as string,
				{ id: firstTab.id as string, mashup_id: firstTab.mashup_id as string | null },
				(srcRows ?? []) as TabSourceTrackRaw[],
				[],
				[],
				[],
				trackMap
			);
			const track = resolved[0]?.track;
			if (track) truth = { artist: track.artist, title: track.title, year: track.year };
		}

		out.push({
			id: c.id as string,
			title: c.title as string,
			variant: c.variant as string,
			tabCount: myTabs.length,
			battle:
				((c.points_config as { battle?: { enabled?: boolean } } | null)?.battle?.enabled ??
					false) === true,
			timer: (c.timer_seconds as number | null) ?? null,
			truth,
			playedByTeams: (subs ?? [])
				.filter((s) => s.challenge_id === c.id)
				.map((s) => s.team_id as string)
		});
	}
	return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   Hulpmiddelen
   ══════════════════════════════════════════════════════════════════════════ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Naam waaronder de simulatie zijn speler aanmaakt — ook de sleutel voor --purge-sim-players. */
const SIM_PLAYER_NAME = 'Sim Speler';

/**
 * Het `hitster_player`-cookie zoals src/lib/server/player.ts het schrijft:
 * `<playerId>.<base64url HMAC-SHA256(playerId, COOKIE_SECRET)>`. Alleen nodig om
 * een achtergebleven simulatiespeler alsnog via /api/player/leave op te ruimen;
 * de normale flow krijgt zijn cookie gewoon van de server.
 */
function signPlayerCookie(playerId: string): string {
	const secret = process.env.COOKIE_SECRET;
	if (!secret) throw new Error('COOKIE_SECRET ontbreekt — nodig voor --purge-sim-players');
	const mac = createHmac('sha256', secret).update(playerId).digest('base64url');
	return `${playerId}.${mac}`;
}

/**
 * Veldnaam op het antwoordformulier. De multi-source-layout (mashup/fragments)
 * gebruikt `{veld}_{slot}`, de single-slot-layout (standard/anthem/label) het
 * kale `{veld}`. Beide vormen worden geprobeerd.
 */
function fieldSelector(form: string, field: string, extra = ''): string {
	return `${form} input[name="${field}_0"]${extra}, ${form} input[name="${field}"]${extra}`;
}

/**
 * Maakt een vierkante "profielfoto" met de browser zelf — geen extra
 * afhankelijkheid, en een echte raster-PNG waarop de ronde uitsnede van moment
 * 05 te beoordelen valt.
 */
async function makeAvatar(ctx: BrowserContext, path: string) {
	const page = await ctx.newPage();
	await page.setViewportSize({ width: 320, height: 320 });
	await page.setContent(`
		<style>
			html,body{margin:0;height:100%}
			body{background:linear-gradient(135deg,#FF2DAA,#7C4DFF 55%,#00E5FF);
			     display:flex;align-items:center;justify-content:center;font-family:system-ui}
			.h{width:120px;height:120px;border-radius:50%;background:#FFE6C7;
			   box-shadow:0 26px 0 -6px #FFE6C7, 0 0 0 10px rgba(11,11,31,.18);transform:translateY(-26px)}
		</style><div class="h"></div>
	`);
	await page.screenshot({ path });
	await page.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   Hoofdstroom
   ══════════════════════════════════════════════════════════════════════════ */

async function main() {
	loadEnv();
	const url = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key)
		throw new Error('Ontbrekende PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
	const db = createClient(url, key, { auth: { persistSession: false } });

	mkdirSync(OUT_DIR, { recursive: true });

	// ── Doelset kiezen ────────────────────────────────────────────────────────
	let setId = flag('set');
	if (!setId) {
		const { data } = await db
			.from('game_sets')
			.select('id, name')
			.eq('status', 'active')
			.order('created_at', { ascending: false })
			.limit(1);
		setId = data?.[0]?.id as string | undefined;
	}
	if (!setId) throw new Error('Geen actieve set gevonden — geef er een op met --set <uuid>');

	const browser = await webkit.launch();
	const host = await browser.newContext({ viewport: { width: 1280, height: 900 } });

	console.log(`▶ Simulatie op ${BASE_URL}`);
	console.log(`  set      ${setId}`);
	console.log(`  viewport ${VW}x${VH} (WebKit, dSF 3, isMobile, hasTouch)`);
	console.log(`  uitvoer  ${OUT_DIR}\n`);

	try {
		// ── Optionele resets (allebei via de app) ───────────────────────────────
		if (has('hard-reset')) {
			notes.push('--hard-reset gedraaid: de in-app reset van de set. Die WIST OOK de teamfotos.');
			await hostAction(host, `/admin/sets/${setId}`, 'resetGame');
		} else if (has('soft-reset')) {
			// Fotoveilig opruimen: ?/resetTeamAttempt op /admin/live gooit precies één
			// (challenge, team)-inzending weg, verwijdert de attempt en trekt de score
			// er weer af. Per inzending aangeroepen ruimt dat de hele set op zonder
			// resetGameState — en dus zonder de teamfoto's te vernietigen.
			const { data: scRows } = await db
				.from('set_challenges')
				.select('challenge_id')
				.eq('set_id', setId);
			const chIds = (scRows ?? []).map((r) => r.challenge_id as string);
			const { data: subRows } = chIds.length
				? await db.from('submissions').select('challenge_id, team_id').in('challenge_id', chIds)
				: { data: [] as Array<{ challenge_id: string; team_id: string }> };
			const pairs = new Set((subRows ?? []).map((r) => `${r.challenge_id}|${r.team_id}`));
			for (const pair of pairs) {
				const [challenge_id, team_id] = pair.split('|');
				await host.request.post(`${BASE_URL}/admin/live?/resetTeamAttempt`, {
					form: { challenge_id, team_id },
					maxRedirects: 5
				});
			}
			// resetTeamAttempt trekt alleen de INZENDINGSCORE af; de +1 die de
			// kroonmechaniek bij een steal bijschrijft blijft staan en zou over
			// meerdere runs oplopen. ?/resetScore op /admin/teams zet de teller
			// hard op 0 en raakt de teamfoto's niet aan.
			const { data: allTeams } = await db.from('teams').select('id');
			for (const t of allTeams ?? []) {
				await host.request.post(`${BASE_URL}/admin/teams?/resetScore`, {
					form: { team_id: t.id as string },
					maxRedirects: 5
				});
			}
			notes.push(
				`--soft-reset: ${pairs.size} inzending(en) opgeruimd via ?/resetTeamAttempt op /admin/live ` +
					`en ${(allTeams ?? []).length} teamscore(s) op 0 via ?/resetScore op /admin/teams ` +
					'(verwijdert submission + attempt en trekt de score af). Teamfotos blijven staan. ' +
					'Wat deze weg NIET opruimt: set_challenges.battle_ranking / battle_resolved_at — ' +
					'een battle die al opgelost is, lost niet opnieuw op. Alleen de volledige in-app ' +
					'reset (--hard-reset) wist die, en die wist óók de teamfotos.'
			);
		}

		// ── Achtergebleven simulatiespelers opruimen ────────────────────────────
		// Elke run ruimt sinds deze versie zijn eigen speler op via
		// /api/player/leave. Runs van vóór die toevoeging lieten er wel een
		// achter; deze vlag haalt die alsnog weg langs dezelfde weg — met een
		// zelf-ondertekend hitster_player-cookie, precies zoals
		// src/lib/server/player.ts het schrijft.
		if (has('purge-sim-players')) {
			const { data: strays } = await db
				.from('players')
				.select('id, display_name')
				.eq('display_name', SIM_PLAYER_NAME);
			let purged = 0;
			for (const p of strays ?? []) {
				const ctx = await browser.newContext();
				await ctx.addCookies([
					{
						name: 'hitster_player',
						value: signPlayerCookie(p.id as string),
						domain: new URL(BASE_URL).hostname,
						path: '/',
						httpOnly: true,
						sameSite: 'Lax'
					}
				]);
				await ctx.request.post(`${BASE_URL}/api/player/leave`);
				await ctx.close();
				purged++;
			}
			const { data: left } = await db
				.from('players')
				.select('id')
				.eq('display_name', SIM_PLAYER_NAME);
			notes.push(
				`--purge-sim-players: ${purged} speler(s) "${SIM_PLAYER_NAME}" langs /api/player/leave gestuurd; ${(left ?? []).length} over.`
			);
		}

		// ── Zorgen dat er gejoind kan worden ────────────────────────────────────
		let state = await readSetState(db, setId);
		if (state.status !== 'active') {
			await hostAction(host, `/admin/sets/${setId}`, 'toggle');
			notes.push('Set stond op inactief en is via ?/toggle geactiveerd.');
			state = await readSetState(db, setId);
		}
		if (state.play_state !== 'joining') {
			// Deactiveren+activeren zet play_state en de recap-tellers terug op nul
			// zonder iets te verwijderen — de fotoveilige weg terug naar de lobby.
			await hostAction(host, `/admin/sets/${setId}`, 'toggle');
			await hostAction(host, `/admin/sets/${setId}`, 'toggle');
			notes.push(
				`Set stond op play_state="${state.play_state}" en is via twee keer ?/toggle teruggezet op "joining".`
			);
			state = await readSetState(db, setId);
		}

		const challenges = await planChallenges(db, setId);
		console.log(`  ${challenges.length} actieve challenge(s) in de set\n`);

		// ── Spelerscontext ──────────────────────────────────────────────────────
		const player = await browser.newContext({
			viewport: { width: VW, height: VH },
			deviceScaleFactor: 3,
			isMobile: true,
			hasTouch: true
		});
		const page = await player.newPage();

		const avatarPath = join(OUT_DIR, '_avatar.png');
		await makeAvatar(player, avatarPath);

		/* ── 01 · Onboarding, leeg ────────────────────────────────────────────── */
		const next = `/sets/${setId}/join`;
		await page.goto(`${BASE_URL}/play/teams?next=${encodeURIComponent(next)}`, {
			waitUntil: 'networkidle'
		});
		await page.waitForSelector('img[alt="M!XUP"]');
		await shoot(page, '01', 'join-leeg', {
			alsoViewport: true,
			waits: ['networkidle + het logo (img[alt="M!XUP"]) in de DOM'],
			verify: async () =>
				(await page.locator('input[name="name"]').inputValue()) === '' &&
				(await page.locator('img[alt="M!XUP"]').isVisible())
		});

		/* ── 02 · Onboarding, naam + foto ─────────────────────────────────────── */
		const playerName = SIM_PLAYER_NAME;
		// LET OP — volgorde is niet vrij: een tik op de fotocirkel wist een al
		// ingetypte naam (het naamveld gebruikt `value={form?.name ?? ''}` zonder
		// bind, en de photoOpen-toggle zet die attribuutwaarde opnieuw). Daarom
		// eerst de foto, dan pas de naam. Zie het rapport.
		await page.click('button[aria-label="Profielfoto toevoegen"]');
		await page.waitForSelector('.onb-sources');
		// De bronknoppen zijn <label>s om sr-only file-inputs; de tweede is GALERIJ.
		await page.locator('.onb-sources input[type="file"]').nth(1).setInputFiles(avatarPath);
		await page.waitForSelector('.onb-photo--filled');
		await page.fill('input[name="name"]', playerName);
		await shoot(page, '02', 'join-ingevuld', {
			waits: ['.onb-sources zichtbaar na tik op de fotocirkel, daarna .onb-photo--filled'],
			forced: [
				'bestand direct op de sr-only file-input gezet — een echte camera kan Playwright niet openen',
				'foto vóór naam ingevuld: een tik op de fotocirkel wist een al ingetypte naam (app-bug, zie rapport)'
			],
			verify: async () =>
				(await page.locator('input[name="name"]').inputValue()) === playerName &&
				(await page.locator('.onb-photo--filled img').isVisible())
		});

		/* ── 03 · Team-reveal met splash ──────────────────────────────────────── */
		await Promise.all([
			page.waitForURL(/\/play\/teams\/randomizing|\/sets\/[^/]+\/(join|in-progress|over)/, {
				timeout: 30_000
			}),
			page.click('button[type="submit"]')
		]);
		const landed = page.url();
		if (!landed.includes('/randomizing')) {
			notes.push(
				`03: geen randomizer bereikt — de flow eindigde op ${landed}. Set staat waarschijnlijk niet op "joining"/random.`
			);
		}
		const teamColor = new URL(page.url()).searchParams.get('team') ?? '';
		// De reveal springt op t=1800 ms; de splashvideo loopt daarna in loop door.
		// 2400 ms zit ruim in het revealvenster en vóór de knop op t=3600 ms.
		await page.waitForSelector('text=JIJ SPEELT VOOR', { timeout: 10_000 });
		await sleep(600);
		await shoot(page, '03', 'team-reveal-splash', {
			alsoViewport: true,
			waits: [
				'op de tekst "JIJ SPEELT VOOR" (fase reveal, t=1800 ms), daarna 600 ms zodat de splashvideo frames heeft'
			],
			verify: async () => {
				const playing = await page
					.locator('video.splash')
					.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0)
					.catch(() => false);
				return playing && (await page.locator('text=JIJ SPEELT VOOR').isVisible());
			},
			note: 'splash draait (video.currentTime > 0) én "JIJ SPEELT VOOR" staat in beeld'
		});

		/* ── 04 · Lobby ───────────────────────────────────────────────────────── */
		await page.goto(`${BASE_URL}/team`, { waitUntil: 'networkidle' });
		await page.waitForSelector('.hub-card');

		// Minstens één teamfoto in de lobby. Staat er geen, dan maakt het script er
		// zelf een via het bestaande ?/uploadTeamPhoto-formulier op deze pagina.
		if ((await page.locator('.lobby-bubble__img').count()) === 0) {
			const input = page.locator('form[action="?/uploadTeamPhoto"] input[type="file"]');
			if (await input.count()) {
				await input.setInputFiles(avatarPath);
				await page.waitForSelector('.photo-slot--filled', { timeout: 20_000 }).catch(() => {});
				await page.reload({ waitUntil: 'networkidle' });
				notes.push(
					'04: geen enkel team had een teamfoto — er is er één geüpload via het ?/uploadTeamPhoto-formulier op /team.'
				);
			}
		}
		const teamPhotos = await page.locator('.lobby-bubble__img').count();
		const playerAvatars = await page.locator('img.lobby-av').count();
		await shoot(page, '04', 'lobby', {
			waits: ['networkidle + .hub-card in de DOM'],
			verify: async () => teamPhotos >= 1 && playerAvatars >= 1,
			note: `${teamPhotos} teamfoto('s) en ${playerAvatars} persoonlijke profielfoto('s) in de rijen`
		});

		/* ── 05 · Uitsnede van de persoonlijke profielfoto ────────────────────── */
		if (wanted('05')) {
			const av = page.locator('img.lobby-av').first();
			const box = await av.boundingBox();
			if (box) {
				const pad = 26;
				const clip: Clip = {
					x: Math.max(0, box.x - pad),
					y: Math.max(0, box.y - pad),
					width: Math.min(VW, box.width + pad * 2),
					height: box.height + pad * 2
				};
				await shoot(page, '05', 'profielfoto-uitsnede', {
					clip,
					waits: [],
					verify: async () => (await av.count()) > 0,
					note: `clip ${Math.round(clip.width)}x${Math.round(clip.height)} rond img.lobby-av (dSF 3 ⇒ ${Math.round(clip.width * 3)}px breed bestand)`
				});
			} else {
				record({
					id: '05',
					file: null,
					hit: false,
					waits: [],
					forced: [],
					note: 'geen img.lobby-av gevonden om uit te snijden'
				});
			}
		}

		/* ── Host start het spel ──────────────────────────────────────────────── */
		await hostAction(host, `/admin/sets/${setId}`, 'startGame');
		await page.goto(`${BASE_URL}/team`, { waitUntil: 'networkidle' });

		/* ── 06 · Team-console bij de start ───────────────────────────────────── */
		await page.waitForSelector('.hub-banner');
		const placeText = (await page.locator('.hub-card .text-mixup-cyan').first().innerText()).trim();
		const counterText = (await page.locator('text=/\\d+\\/\\d+ KLAAR/').first().innerText()).trim();
		const scoreText = (
			await page.locator('.hub-card .text-mixup-yellow').first().innerText()
		).trim();
		const activeCount = challenges.length;
		await shoot(page, '06', 'console-start', {
			waits: ['networkidle + .hub-banner in de DOM'],
			verify: async () => placeText === '–' && counterText.endsWith(`/${activeCount} KLAAR`),
			note: `score "${scoreText}", positie "${placeText}", teller "${counterText}" (actieve challenges in de set: ${activeCount})`
		});

		/* ── 07 · UITLEG-popup met één variant uitgeklapt ─────────────────────── */
		if (wanted('07')) {
			await page.locator('button:has-text("UITLEG")').first().click();
			await page.waitForSelector('[role="dialog"]');
			const tiles = page.locator('[role="dialog"] .tile');
			const nTiles = await tiles.count();
			if (nTiles > 0) await tiles.first().click();
			await sleep(250);
			await shoot(page, '07', 'uitleg-popup', {
				waits: ['[role="dialog"] in de DOM, daarna 250 ms voor de uitklap'],
				verify: async () =>
					(await page.locator('[role="dialog"] .tile--on').count()) > 0 || nTiles === 0,
				note:
					nTiles > 0
						? `${nTiles} varianttegels, de eerste uitgeklapt`
						: 'één variant in de set — de tekst staat direct open, er is geen tegel om uit te klappen'
			});
			await page.locator('[role="dialog"] button:has-text("Begrepen")').click();
			await page.waitForSelector('[role="dialog"]', { state: 'detached' });
		}

		/* ── Challenge kiezen: multi-tab (dus met VOLGENDE) en nog niet gespeeld ─ */
		const { data: teamRow } = await db
			.from('teams')
			.select('id, display_name')
			.eq('color', teamColor)
			.maybeSingle();
		const teamId = teamRow?.id as string | undefined;

		const candidates = challenges
			.filter((c) => c.tabCount > 1 && (!teamId || !c.playedByTeams.includes(teamId)))
			.sort((a, b) => Number(b.battle) - Number(a.battle) || (b.timer ?? 0) - (a.timer ?? 0));
		const target =
			candidates[0] ?? challenges.find((c) => !teamId || !c.playedByTeams.includes(teamId));

		if (!target) {
			notes.push(
				'08-12: geen speelbare challenge meer over voor dit team — alle actieve challenges zijn al ingeleverd. Draai met --soft-reset of kies een set met een ongespeelde challenge.'
			);
		} else {
			console.log(
				`\n  challenge: ${target.title} (${target.variant}, ${target.tabCount} tabs, battle=${target.battle}, timer=${target.timer}s)\n`
			);

			/* ── 08 · Pre-game poort ──────────────────────────────────────────── */
			// De NFC-ontgrendeling is een gewone app-route; die staat gelijk aan het
			// scannen van de unlock-sticker.
			await page.goto(`${BASE_URL}/nfc/unlock/${setId}/${target.id}`, { waitUntil: 'networkidle' });
			await page.waitForURL(new RegExp(`/challenge/${target.id}`), { timeout: 20_000 });
			const gateVisible = await page
				.locator('button:has-text("Start de challenge")')
				.isVisible()
				.catch(() => false);
			await shoot(page, '08', 'challenge-intro', {
				waits: ['redirect van /nfc/unlock/… naar /challenge/[id]'],
				forced: [
					'de NFC-tap is nagebootst met /nfc/unlock/[set]/[challenge] — de set heeft nfc_lock aan'
				],
				verify: async () =>
					gateVisible &&
					(await page
						.locator('text=Hoe werkt het')
						.isVisible()
						.catch(() => false)),
				note: gateVisible
					? 'poort staat open met "Hoe werkt het"-blok en de startknop'
					: 'geen pre-game poort — dit team had al een attempt op deze challenge'
			});

			/* ── 09 · Antwoordformulier, volledige pagina ─────────────────────── */
			if (gateVisible) {
				await page.click('button:has-text("Start de challenge")');
				// De startknop doet window.location.reload() zodat onMount de timer
				// opnieuw uit timerEndsAt opzet — daar wachten we op.
				await page.waitForSelector('#challenge-answer-form', { timeout: 30_000 });
			}
			await page.waitForSelector('#challenge-answer-form', { timeout: 20_000 });
			await page.waitForLoadState('networkidle');
			await sleep(400);

			const hasSlider =
				(await page.locator('#challenge-answer-form input[type="range"]').count()) > 0;
			const hasNext = (await page.locator('button:has-text("Volgende")').count()) > 0;
			const puBarVisible = await page
				.locator('.pu-bar')
				.isVisible()
				.catch(() => false);
			await shoot(page, '09', 'antwoordformulier-track1', {
				fullPage: true,
				waits: ['#challenge-answer-form in de DOM, networkidle, daarna 400 ms voor de audiokaart'],
				verify: async () => hasSlider && hasNext && puBarVisible,
				note: `jaarslider=${hasSlider}, VOLGENDE-knop=${hasNext}, powerup-balk zichtbaar=${puBarVisible} — fullPage-opname`
			});

			/* ── 10 · Zelfde scherm met "toetsenbord" ─────────────────────────── */
			if (wanted('10')) {
				const leftover = KEYBOARD_LEFTOVER[VH] ?? Math.round(VH * 0.6);
				await page.setViewportSize({ width: VW, height: leftover });
				const titleField = page.locator(fieldSelector('#challenge-answer-form', 'title')).first();
				const focusTarget = (await titleField.count())
					? titleField
					: page.locator('#challenge-answer-form input[type="text"]').first();
				await focusTarget.scrollIntoViewIfNeeded();
				await focusTarget.focus();
				await sleep(400);

				const inView = async (sel: string) => {
					const el = page.locator(sel).first();
					if (!(await el.count())) return false;
					const b = await el.boundingBox();
					return !!b && b.y >= -1 && b.y + b.height <= leftover + 1;
				};
				const clockOk = await inView('.stick-top .tabular-nums');
				const audioOk = await inView('.stick-top');
				const barOk = await inView('.pu-bar');

				await shoot(page, '10', 'antwoordformulier-toetsenbord', {
					waits: [
						`viewport gekrompen naar ${VW}x${leftover}, focus in het titelveld, 400 ms settle`
					],
					forced: [
						`WebKit onder Playwright kent geen iOS-softwaretoetsenbord — benaderd door de vensterhoogte terug te brengen van ${VH} naar ${leftover} px (de ruimte die een iOS-toetsenbord overlaat). Daardoor krimpt het layout-viewport mee en blijft --kb-inset op 0; de sticky balk staat dan op bottom:0 van het gekrompen venster, visueel hetzelfde als "boven het toetsenbord" op iOS.`
					],
					verify: async () => clockOk && audioOk && barOk,
					note: `klok in beeld=${clockOk}, sticky bovenzone in beeld=${audioOk}, powerup-balk in beeld=${barOk}`
				});
				await page.setViewportSize({ width: VW, height: VH });
				await sleep(200);
			}

			/* ── Antwoorden invullen en inleveren ──────────────────────────────── */
			if (target.truth) {
				const t = target.truth;
				const F = '#challenge-answer-form';
				const filled: string[] = [];

				const titleInput = page.locator(fieldSelector(F, 'title')).first();
				if ((await titleInput.count()) && t.title) {
					await titleInput.fill(t.title);
					filled.push('title');
				}

				const yearRange = page.locator(fieldSelector(F, 'year', '[type="range"]')).first();
				if ((await yearRange.count()) && t.year) {
					await yearRange.evaluate((el, year) => {
						const input = el as HTMLInputElement;
						input.value = String(year);
						input.dispatchEvent(new Event('input', { bubbles: true }));
						input.dispatchEvent(new Event('change', { bubbles: true }));
					}, t.year);
					filled.push('year');
				}

				// Combobox: de zichtbare tekstinput staat naast de hidden input met de
				// veldnaam. Een exacte pooltreffer bevestigt de waarde vanzelf.
				const hiddenArtist = page.locator(fieldSelector(F, 'artist', '[type="hidden"]')).first();
				if ((await hiddenArtist.count()) && t.artist) {
					const visible = page
						.locator(`${F} div.relative`, { has: hiddenArtist })
						.locator('input[type="text"]')
						.first();
					if (await visible.count()) {
						await visible.fill(t.artist);
						await sleep(250);
						if ((await hiddenArtist.inputValue()) === t.artist) filled.push('artist');
					}
				} else {
					const plainArtist = page.locator(fieldSelector(F, 'artist', '[type="text"]')).first();
					if ((await plainArtist.count()) && t.artist) {
						await plainArtist.fill(t.artist);
						filled.push('artist');
					}
				}
				notes.push(
					`11: op tab 1 ingevuld: ${filled.join(', ') || 'niets'} (bron: ${t.artist ?? '?'} — ${t.title ?? '?'} / ${t.year ?? '?'}).`
				);
			} else {
				notes.push(
					`11: geen bronrack te herleiden voor tab 1 van "${target.title}" — de antwoorden zijn leeg ingeleverd, dus de score kan 0 blijven.`
				);
			}

			// Doorklikken naar de laatste tab: Inleveren bestaat alleen daar.
			let guard = 0;
			while ((await page.locator('button:has-text("Volgende")').count()) > 0 && guard++ < 40) {
				await page.locator('button:has-text("Volgende")').first().click();
				await sleep(120);
			}
			await page.locator('button:has-text("Inleveren")').first().click();
			await page
				.waitForSelector('#challenge-answer-form', { state: 'detached', timeout: 30_000 })
				.catch(() => {});
			await sleep(1200);

			/* ── 11 · Console na een afgeronde challenge ──────────────────────── */
			await page.goto(`${BASE_URL}/team`, { waitUntil: 'networkidle' });
			await page.waitForSelector('.hub-banner');
			const crownVisible = await page
				.locator('img.hub-crown')
				.isVisible()
				.catch(() => false);
			const place11 = (await page.locator('.hub-card .text-mixup-cyan').first().innerText()).trim();
			const score11 = (
				await page.locator('.hub-card .text-mixup-yellow').first().innerText()
			).trim();
			await shoot(page, '11', 'console-na-challenge', {
				waits: ['networkidle + .hub-banner in de DOM'],
				verify: async () => crownVisible && place11 === '#1',
				note: `score "${score11}", positie "${place11}", kroon zichtbaar=${crownVisible}`
			});
		}

		/* ── Host start de recap ──────────────────────────────────────────────── */
		await hostAction(host, `/admin/sets/${setId}`, 'startRecap');
		state = await readSetState(db, setId);

		/* ── 12 · Battle-ranglijst op het wachtscherm ─────────────────────────── */
		if (state.recap_state === 'battle_reveal') {
			// Doorgaan tot de NIEUWSTE onthulde battle daadwerkelijk punten bevat.
			// De kaart toont de opgeslagen battle_ranking; een battle die in een
			// eerdere run zonder score is opgelost staat op nul en illustreert niets.
			// De nieuwste onthulde kaart staat bovenaan (revealedBattles is omgekeerd).
			const battleScores = await readBattleScores(db, setId);
			let revealed = 0;
			let scored = false;
			while (revealed < battleScores.length) {
				await hostAction(host, `/admin/sets/${setId}/recap`, 'reveal');
				revealed++;
				if (battleScores[revealed - 1] > 0) {
					scored = true;
					break;
				}
			}
			await page.goto(`${BASE_URL}/play/waiting?set_id=${setId}`, { waitUntil: 'networkidle' });
			await page.waitForSelector('.wait__battles', { timeout: 20_000 }).catch(() => {});
			await sleep(500);
			const cards = await page.locator('.wait__battles > *').count();
			await shoot(page, '12', 'battle-ranglijst', {
				waits: [
					`${revealed} host-reveal(s) → battle_reveal_index ${revealed}, daarna .wait__battles in de DOM + 500 ms`
				],
				verify: async () => (await page.locator('.wait__battles').count()) > 0,
				note: scored
					? `${cards} battlekaart(en) op /play/waiting; de bovenste battle heeft een team met punten`
					: `${cards} battlekaart(en) op /play/waiting, maar geen enkele opgeslagen ranglijst bevat punten (alle battles zijn ooit met 0 opgelost)`
			});
			state = await readSetState(db, setId);
		} else {
			record({
				id: '12',
				file: null,
				hit: false,
				waits: [],
				forced: [],
				note: `recap opende op "${state.recap_state}" in plaats van "battle_reveal" — er is geen battle met inzendingen om te onthullen`
			});
		}

		// Battlefase afmaken tot de teamcascade begint.
		let spin = 0;
		while (state.recap_state === 'battle_reveal' && spin++ < 20) {
			await hostAction(host, `/admin/sets/${setId}/recap`, 'reveal');
			state = await readSetState(db, setId);
		}

		/* ── 13 / 14 · Podium ─────────────────────────────────────────────────── */
		// Onthullen tot er precies één plek over is: plek 1.
		const teamsInSet = state.team_count;
		let revealSteps = 0;
		while ((state.recap_reveal_index ?? 0) < teamsInSet - 1 && revealSteps++ < 20) {
			await hostAction(host, `/admin/sets/${setId}/recap`, 'reveal');
			state = await readSetState(db, setId);
		}

		const podium = await player.newPage();
		await podium.setViewportSize({ width: VW, height: VH });
		await podium.goto(`${BASE_URL}/sets/${setId}/podium`, { waitUntil: 'networkidle' });
		await podium.waitForSelector('.stage', { timeout: 20_000 }).catch(() => {});
		await sleep(2500); // reveal-animaties van de lagere plekken uitlopen

		// Clip op de BOVENRAND van de plek-1-kaart. Eén keer gemeten in de
		// niet-onthulde staat en daarna ongewijzigd hergebruikt, zodat 13 en 14
		// naast elkaar te leggen zijn.
		const winnerCol = podium.locator('.col', { has: podium.locator('.crown-anchor') });
		const winnerBox = winnerCol.locator('.box').first();
		let edgeClip: Clip | null = null;
		const bb14 = await winnerBox.boundingBox().catch(() => null);
		if (bb14) {
			const padX = 34;
			const above = 46;
			const below = 64;
			edgeClip = {
				x: Math.max(0, bb14.x - padX),
				y: Math.max(0, bb14.y - above),
				width: Math.min(VW - Math.max(0, bb14.x - padX), bb14.width + padX * 2),
				height: above + below
			};
		}

		await shoot(podium, '14', 'podium-plek1-verborgen', {
			clip: edgeClip ?? undefined,
			alsoViewport: true,
			waits: [
				`host-reveals tot recap_reveal_index=${state.recap_reveal_index}/${teamsInSet}, .stage in de DOM, 2500 ms voor de onthulanimaties`
			],
			verify: async () =>
				(await winnerBox.count()) > 0 &&
				!(await winnerBox
					.evaluate((el) => el.classList.contains('box--revealed'))
					.catch(() => true)),
			note: edgeClip
				? `clip x=${Math.round(edgeClip.x)} y=${Math.round(edgeClip.y)} ${Math.round(edgeClip.width)}x${Math.round(edgeClip.height)} — deze coördinaten worden hergebruikt voor 13`
				: 'geen .box van plek 1 gevonden; volledige viewport vastgelegd'
		});

		// De laatste onthulling: plek 1.
		await hostAction(host, `/admin/sets/${setId}/recap`, 'reveal');
		state = await readSetState(db, setId);
		await podium.waitForSelector('.box--revealed', { timeout: 15_000 }).catch(() => {});
		await sleep(2600); // box--fresh duurt 2000 ms

		const bb13 = await winnerBox.boundingBox().catch(() => null);
		if (bb14 && bb13 && Math.abs(bb13.y - bb14.y) > 1) {
			notes.push(
				`13/14: de plek-1-kaart verschoof ${Math.round(bb13.y - bb14.y)} px verticaal tussen de twee staten (de kop boven het podium herschikt bij de onthulling). De clip-coördinaten zijn tóch identiek gehouden, zoals gevraagd.`
			);
		}

		await shoot(podium, '13', 'podium-plek1-onthuld', {
			clip: edgeClip ?? undefined,
			alsoViewport: true,
			waits: [
				'laatste host-reveal, .box--revealed in de DOM, 2600 ms zodat de box--fresh-animatie (2000 ms) uitgespeeld is'
			],
			verify: async () =>
				(await podium.locator('.col:has(.crown-anchor) .box--revealed').count()) > 0,
			note: edgeClip ? 'exact dezelfde clip-coördinaten als 14' : 'volledige viewport'
		});

		/* ── Terugzetten ──────────────────────────────────────────────────────── */
		// Eerst de eigen spelersessie opruimen, via het bestaande
		// /api/player/leave (verwijdert de players-rij én de profielfoto uit
		// storage). Zonder dit laat elke run een simulatiespeler in de lobby
		// achter, en die zou op de echte avond gewoon meedoen.
		const left = await player.request
			.post(`${BASE_URL}/api/player/leave`)
			.then((r) => r.ok())
			.catch(() => false);
		notes.push(
			left
				? 'De simulatiespeler is na afloop opgeruimd via POST /api/player/leave (players-rij + profielfoto weg).'
				: 'LET OP: POST /api/player/leave gaf geen ok — de simulatiespeler staat mogelijk nog in de set.'
		);

		if (!has('keep-state')) {
			await hostAction(host, `/admin/sets/${setId}`, 'toggle');
			await hostAction(host, `/admin/sets/${setId}`, 'toggle');
			notes.push(
				'Na afloop is de set met twee keer ?/toggle teruggezet op status=active / play_state=joining / recap_state=pending. Dat verwijdert niets: inzendingen, teamscores, battle-ranglijsten en teamfotos blijven staan.'
			);
		}
	} finally {
		await host.close();
		await browser.close();
	}

	/* ── Run-log wegschrijven ───────────────────────────────────────────────── */
	const logPath = join(OUT_DIR, `run-log${LABEL ? `--${LABEL}` : ''}.json`);
	writeFileSync(
		logPath,
		JSON.stringify(
			{ setId, baseUrl: BASE_URL, viewport: `${VW}x${VH}`, shots: log, notes },
			null,
			2
		) + '\n'
	);
	console.log(`\n📝 Run-log → ${logPath}`);
	const missed = log.filter((s) => !s.hit).map((s) => s.id);
	console.log(
		missed.length
			? `⚠ Niet bevestigd: ${missed.join(', ')}`
			: '✓ Alle vastgelegde momenten bevestigd'
	);
	for (const n of notes) console.log(`  · ${n}`);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.stack : err);
	process.exit(1);
});
