// STRUCTURAL guard for de spelerssessie: terugkeren mag nooit uitloggen.
//
// ── Wat hier bewaakt wordt ───────────────────────────────────────────────────
//
// Drie eigenschappen van de SHAPE van de broncode, elk de tegenhanger van een
// echte bug die dit bestand moet tegenhouden:
//
//   1. In elk instappunt van de join-flow staat de "deze speler zit al in deze
//      set"-controle VÓÓR de play_state-poort. Stond hij erachter, dan kreeg
//      een speler die de app verliet en er weer in veegde het doodlopende
//      scherm "Het spel is al bezig" — dat linkt alleen naar /leaderboard en
//      /, dus voor hem was zijn sessie weg terwijl zijn cookies geldig waren.
//
//   2. Geen enkele speler-route leest de cookie rechtstreeks
//      (getPlayerIdFromCookie / getTeamIdFromCookie). Alleen locals.playerId en
//      locals.teamId zijn door de sessie-epoch-controle in hooks.server.ts
//      heen; wie de cookie rechtstreeks leest slaat die controle over en laat
//      speler- en teamcookie uit elkaar lopen. /api/dev/state is de enige
//      uitzondering: die TOONT de ruwe cookie als diagnose en draait niet in
//      productie.
//
//   3. game_sets.player_epoch wordt op precies één plek geschreven —
//      bumpSessionEpoch() — en die wordt op precies één plek aangeroepen:
//      resetGameState(). Dat is de hele belofte van de epoch: alleen een
//      host-reset logt spelers uit, wegnavigeren nooit.
//
// ── Waarom structureel ───────────────────────────────────────────────────────
//
// Deze eigenschappen gaan over VOLGORDE en over de AFWEZIGHEID van een
// aanroep. Voor de volgorde zou een gedragstest een echte set op `playing`
// moeten zetten met een echte spelersrij en een echte cookie; voor de
// afwezigheid bestaat geen gedragstest — je kunt niet waarnemen dat iets niet
// gebeurt. Zelfde afweging, en dezelfde techniek, als
// tests/bots/auto-submit-structure.ts.
//
// Commentaar en string-INHOUD worden geblankt met behoud van offsets, zodat
// regelnummers kloppen en een hernoemde melding of een toegevoegde uitleg de
// uitslag niet omgooit. De bronbestanden gaan ALLEEN-LEZEN open; de
// falsificaties hieronder muteren een string in het geheugen, nooit een
// bestand.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** Instappunten die een terugkerende speler op zijn eigen sessie moeten zetten. */
export const ENTRY_POINTS = [
	'src/routes/sets/[id]/join/+page.server.ts',
	'src/routes/nfc/randomize/[set_id]/+page.server.ts'
];

const EPOCH_MODULE = 'src/lib/server/session-epoch.ts';
const RESET_MODULE = 'src/lib/server/reset.ts';
/** Diagnosepagina: toont de ruwe cookie met opzet, draait niet in productie. */
const RAW_COOKIE_EXEMPT = ['src/routes/api/dev/state/+server.ts'];

export function read(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

/**
 * Commentaar en string-inhoud blanken, offsets behouden. Zonder dit zou het
 * woord "in-progress" in een uitlegblok als code meetellen.
 */
export function blank(src: string): string {
	const out = src.split('');
	let i = 0;
	while (i < src.length) {
		const two = src.slice(i, i + 2);
		if (two === '//') {
			while (i < src.length && src[i] !== '\n') out[i++] = ' ';
			continue;
		}
		if (two === '/*') {
			const end = src.indexOf('*/', i + 2);
			const stop = end === -1 ? src.length : end + 2;
			for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' ';
			continue;
		}
		if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
			const quote = src[i];
			i++;
			while (i < src.length && src[i] !== quote) {
				if (src[i] === '\\') {
					out[i] = ' ';
					i++;
					if (i < src.length && src[i] !== '\n') out[i] = ' ';
					i++;
					continue;
				}
				if (src[i] !== '\n') out[i] = ' ';
				i++;
			}
			i++;
			continue;
		}
		i++;
	}
	return out.join('');
}

/** Regelnummer (1-gebaseerd) van een offset — voor leesbare meldingen. */
function lineOf(src: string, index: number): number {
	return src.slice(0, index).split('\n').length;
}

export type OrderVerdict = { ok: boolean; detail: string };

/**
 * Eigenschap 1: de resume-tak (`player?.set_id === set_id` / `=== params.id`)
 * staat vóór elke doorverwijzing naar een "spel al bezig"/"spel voorbij"-poort.
 */
export function checkResumeBeforeGate(source: string, label: string): OrderVerdict {
	const code = blank(source);

	const resume = code.search(/player\?\.set_id\s*===\s*set_id|player\?\.set_id\s*===\s*params\.id/);
	if (resume === -1) {
		return { ok: false, detail: `${label}: geen resume-controle op players.set_id gevonden` };
	}

	// De poorten: play_state-vergelijkingen die de speler wegsturen.
	const gates: number[] = [];
	const re = /play_state\s*===/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(code)) !== null) gates.push(m.index);

	if (gates.length === 0) {
		return {
			ok: false,
			detail: `${label}: geen play_state-poort gevonden — is de route verplaatst?`
		};
	}

	const firstGate = Math.min(...gates);
	if (resume < firstGate) {
		return {
			ok: true,
			detail: `${label}: resume op regel ${lineOf(source, resume)} vóór poort op regel ${lineOf(source, firstGate)}`
		};
	}
	return {
		ok: false,
		detail: `${label}: resume staat op regel ${lineOf(source, resume)}, ACHTER de play_state-poort op regel ${lineOf(source, firstGate)} — een terugkerende speler belandt op een doodlopend scherm`
	};
}

/** Eigenschap 2: geen ruwe cookie-lezingen in routes. */
export function findRawCookieReads(root = 'src/routes'): string[] {
	const hits: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) {
				walk(p);
				continue;
			}
			if (!/\.(ts|svelte)$/.test(name)) continue;
			const rel = p.replace(/\\/g, '/').slice(p.indexOf('src/routes'));
			if (RAW_COOKIE_EXEMPT.includes(rel)) continue;
			const code = blank(readFileSync(p, 'utf8'));
			if (/getPlayerIdFromCookie|getTeamIdFromCookie/.test(code)) hits.push(rel);
		}
	};
	walk(resolve(process.cwd(), root));
	return hits;
}

/** Eigenschap 3: player_epoch wordt alleen door een reset opgetild. */
export function checkEpochWriters(): OrderVerdict {
	const epochSrc = blank(read(EPOCH_MODULE));
	const writes = (epochSrc.match(/player_epoch:/g) ?? []).length;
	if (writes !== 1) {
		return {
			ok: false,
			detail: `${EPOCH_MODULE}: ${writes} schrijfacties op player_epoch, verwacht 1`
		};
	}

	const callers: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) {
				walk(p);
				continue;
			}
			if (!/\.(ts|svelte)$/.test(name)) continue;
			const rel = p.slice(p.indexOf('src/'));
			if (rel === EPOCH_MODULE) continue;
			const code = blank(readFileSync(p, 'utf8'));
			if (/bumpSessionEpoch\s*\(/.test(code)) callers.push(rel);
		}
	};
	walk(resolve(process.cwd(), 'src'));

	if (callers.length === 1 && callers[0] === RESET_MODULE) {
		return { ok: true, detail: `bumpSessionEpoch() alleen aangeroepen vanuit ${RESET_MODULE}` };
	}
	return {
		ok: false,
		detail: `bumpSessionEpoch() aangeroepen vanuit [${callers.join(', ')}] — de epoch mag alleen bij een host-reset opschuiven`
	};
}

function main(): void {
	const results: OrderVerdict[] = [];

	for (const path of ENTRY_POINTS) {
		results.push(checkResumeBeforeGate(read(path), path));
	}

	const raw = findRawCookieReads();
	results.push({
		ok: raw.length === 0,
		detail:
			raw.length === 0
				? 'geen route leest de cookie langs de sessie-epoch heen'
				: `ruwe cookie-lezing in [${raw.join(', ')}] — die sla(a)t de sessie-epoch over`
	});

	results.push(checkEpochWriters());

	// ── Falsificatie: gaat de volgordecontrole ook echt rood? ────────────────
	// Zonder dit zou een check die altijd `ok` teruggeeft er groen uitzien. De
	// bron wordt hier in het GEHEUGEN omgedraaid, niet op schijf.
	const sample = read(ENTRY_POINTS[0]);
	const resumeBlock = sample.match(/\tif \(playerId\) \{[\s\S]*?\n\t\}\n/);
	let falsified: OrderVerdict;
	if (!resumeBlock) {
		falsified = { ok: false, detail: 'falsificatie: resume-blok niet herkend in de bron' };
	} else {
		const moved = sample.replace(resumeBlock[0], '') + '\n' + resumeBlock[0];
		const v = checkResumeBeforeGate(moved, 'falsificatie (resume naar achteren verplaatst)');
		falsified = {
			ok: !v.ok,
			detail: v.ok
				? 'falsificatie: check bleef GROEN terwijl resume achter de poort stond — de check bewijst niets'
				: 'falsificatie: check wordt rood zodra resume achter de poort staat'
		};
	}
	results.push(falsified);

	let failed = 0;
	for (const r of results) {
		console.log(`${r.ok ? '✅' : '❌'} ${r.detail}`);
		if (!r.ok) failed++;
	}
	console.log(failed === 0 ? '\nAlles groen.' : `\n${failed} controle(s) rood.`);
	process.exit(failed === 0 ? 0 : 1);
}

// Alleen draaien als dit bestand zelf is aangeroepen — de controles hierboven
// zijn exporteerbaar, zodat een ander script ze op WILLEKEURIGE bron kan
// loslaten (bijvoorbeeld een oudere versie uit git) zonder deze uitvoer.
if (process.argv[1]?.endsWith('verify-session-resume.ts')) main();
